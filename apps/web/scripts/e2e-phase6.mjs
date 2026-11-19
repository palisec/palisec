#!/usr/bin/env node
/**
 * Phase 6 end to end: the loosening delay and asset safety.
 *
 *   Part 1 (loosening delay), any test server with PALISEC_TEST_DEFAULT_DELAY_SECONDS=3:
 *     BASE_URL=http://localhost:3002 node apps/web/scripts/e2e-phase6.mjs delay
 *   Part 2 (asset safety on a mainnet fork; no real money). Start `anvil --fork-url <mainnet RPC>` on
 *   8545, a server with RH_MAINNET_RPC_URL=http://127.0.0.1:8545 on BASE_URL, and a second one with
 *   PALISEC_SIMULATION=off as OFF_URL:
 *     BASE_URL=http://localhost:3003 OFF_URL=http://localhost:3004 node apps/web/scripts/e2e-phase6.mjs assets
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, maxUint256, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.BASE_URL ?? "http://localhost:3002";
const OFF = process.env.OFF_URL;
const PART = process.argv[2] ?? "delay";
let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  -> ${JSON.stringify(detail).slice(0, 400)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);

async function call(method, path, { cookie, key, body, base = BASE } = {}) {
  const h = { origin: base };
  if (body !== undefined) h["content-type"] = "application/json";
  if (cookie) h.cookie = cookie;
  if (key) h.authorization = `Bearer ${key}`;
  const t = Date.now();
  const res = await fetch(`${base}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed, headers: res.headers, ms: Date.now() - t };
}
async function signIn(account, chain, base = BASE) {
  const c = await call("POST", "/auth/challenges", { body: { address: account.address, chain_id: chain }, base });
  const signature = await account.signMessage({ message: c.body.message });
  const v = await call("POST", "/auth/verify", { body: { nonce: c.body.nonce, signature }, base });
  return (v.headers.get("set-cookie") ?? "").split(";")[0];
}
async function policyFor(cookie, key, chain, account, edit) {
  const p = await call("POST", "/policies", { cookie, body: { name: key, policy_key: key, chain_id: chain, account } });
  const doc = edit(structuredClone(p.body.draft));
  const saved = await call("PUT", `/policies/${p.body.id}`, { cookie, body: { document: doc } });
  const act = await call("POST", `/policies/${p.body.id}/activate`, { cookie, body: { confirm: true, draft_hash: saved.body.draft_hash } });
  return { id: p.body.id, doc, act };
}
async function activate(cookie, id, doc) {
  const saved = await call("PUT", `/policies/${id}`, { cookie, body: { document: doc } });
  return call("POST", `/policies/${id}/activate`, { cookie, body: { confirm: true, draft_hash: saved.body.draft_hash } });
}

// ================================================================ Part 1: loosening delay
async function delayPart() {
  const CHAIN = 46630;
  const owner = privateKeyToAccount(generatePrivateKey());
  const ACCOUNT = privateKeyToAccount(generatePrivateKey()).address;
  const TARGET = privateKeyToAccount(generatePrivateKey()).address;
  const cookie = await signIn(owner, CHAIN);

  // Webhook receiver for the alerts.
  const received = [];
  const server = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      received.push({ type: req.headers["palisec-event-type"], body: JSON.parse(b || "{}") });
      res.end("ok");
    });
  }).listen(4555);
  await call("POST", "/webhooks", { cookie, body: { url: "http://127.0.0.1:4555/hook", events: ["policy.loosening_pending", "policy.loosening_applied", "policy.loosening_cancelled"] } });

  const base = (d) => ({
    ...d,
    asset_safety: { ...d.asset_safety, enabled: false },
    limits: { ...d.limits, max_transaction_value_wei: "1000", max_price_age_seconds: 600, max_pending_operations: 50 },
    cooldowns: { identical_calldata_seconds: 0, identical_intent_seconds: 0 },
    contracts: { default: "deny", allowlist: [{ address: TARGET, selectors: [], require_verified_code: false }], denylist: [] },
    human_approval: { usd_threshold_micros: "999999999999", require_for_unknown_methods: false },
  });
  const pol = await policyFor(cookie, "phase6_delay", CHAIN, ACCOUNT, base);
  check("a policy no agent uses activates at once", pol.act.status === 200 && pol.act.body.state === "active" && pol.act.body.active_version === 1, pol.act.body);
  const agent = await call("POST", "/agents", { cookie, body: { name: "Delay agent", chain_id: CHAIN, account: ACCOUNT, policy_id: pol.id } });
  const key = (await call("POST", `/agents/${agent.body.id}/credentials`, { cookie, body: {} })).body.secret;
  const op = (value) => call("POST", "/authorizations/evaluate", { key, body: { request_id: `d-${crypto.randomUUID()}`, chain_id: CHAIN, to: TARGET, value_wei: String(value), data: "0x", gas_limit: 21000, deadline: now() + 120 } });

  let r = await op(5000);
  check("v1 denies 5000 wei (limit 1000)", r.body.decision === "DENY" && r.body.reason_code === "PS_BUDGET_001" && r.body.policy_version === 1, r.body);

  // Tightening applies at once.
  let doc = { ...pol.doc, limits: { ...pol.doc.limits, max_transaction_value_wei: "900" } };
  r = await activate(cookie, pol.id, doc);
  check("tightening (lower limit) applies immediately", r.body.state === "active" && r.body.active_version === 2 && r.body.effective_at === null, r.body);

  // Loosening waits.
  doc = { ...doc, limits: { ...doc.limits, max_transaction_value_wei: "1000000" } };
  r = await activate(cookie, pol.id, doc);
  const pendingVersion = r.body.activated_version;
  check("loosening (higher limit) enters pending_activation with effective_at", r.body.state === "pending_activation" && r.body.active_version === 2 && !!r.body.effective_at, r.body);
  check("the diff names the change", r.body.changes?.some((c) => c.kind === "loosening" && c.path === "$.limits.max_transaction_value_wei"), r.body.changes);
  const pend = await call("GET", `/policies/${pol.id}/pending`, { cookie });
  check("GET /v1/policies/{id}/pending shows it", pend.status === 200 && pend.body.pending?.policy_version === pendingVersion, pend.body);
  r = await op(5000);
  check("while pending, the old version decides (DENY under v2)", r.body.decision === "DENY" && r.body.policy_version === 2, r.body);
  await sleep(3600);
  r = await op(5000);
  check("after effective_at the new version decides (ALLOW under the new version)", r.body.decision === "ALLOW" && r.body.policy_version === pendingVersion, r.body);

  // Cancel.
  doc = { ...doc, limits: { ...doc.limits, max_transaction_value_wei: "2000000" } };
  r = await activate(cookie, pol.id, doc);
  check("another loosening is pending", r.body.state === "pending_activation", r.body);
  const c = await call("POST", `/policies/${pol.id}/pending/cancel`, { cookie, body: {} });
  check("cancel works at once", c.status === 200 && c.body.cancelled?.state === "cancelled" && c.body.policy?.pending === null, c.body);
  await sleep(3600);
  r = await op(1500000);
  check("the cancelled version never applies", r.body.decision === "DENY", r.body);
  const audit = await call("GET", "/audit-events?limit=100", { cookie });
  const types = (audit.body.events ?? []).map((e) => e.type);
  check("audit records requested, pending, applied and cancelled", ["policy.activation_requested", "policy.loosening_pending", "policy.loosening_applied", "policy.loosening_cancelled"].every((t) => types.includes(t)), [...new Set(types)]);
  const cancelledEv = (audit.body.events ?? []).find((e) => e.type === "policy.loosening_cancelled");
  check("the cancellation is audited with who did it and the diff", (cancelledEv?.actor_address ?? cancelledEv?.actor ?? cancelledEv?.actor_user_id) && Array.isArray(cancelledEv.detail?.diff) && cancelledEv.detail.diff.length > 0, cancelledEv);

  // Delay changes.
  r = await call("POST", "/organization/delays", { cookie, body: { confirm: true, loosening_delay_seconds: 10 } });
  check("raising the delay applies at once", r.body.loosening_delay_seconds === 10, r.body);
  r = await call("POST", "/organization/delays", { cookie, body: { confirm: true, loosening_delay_seconds: 2 } });
  check("lowering the delay is itself delayed", r.body.loosening_delay_seconds === 10 && r.body.pending_changes?.some((p) => p.kind === "delay_change"), r.body);
  await call("POST", `/pending-changes/${r.body.pending_changes.find((p) => p.kind === "delay_change").id}/cancel`, { cookie, body: {} });
  await call("POST", "/organization/delays", { cookie, body: { confirm: true, loosening_delay_seconds: 3 } });

  // Emergency stop.
  r = await call("POST", "/organization/emergency-stop", { cookie, body: { active: true, confirm: true } });
  check("engaging the stop is instant", r.body.emergency_stop === true, r.body);
  r = await call("POST", "/organization/emergency-stop", { cookie, body: { active: false, confirm: true } });
  check("lifting waits (lift pending)", r.body.emergency_stop === true && r.body.pending_changes?.some((p) => p.kind === "emergency_lift"), r.body);
  r = await call("POST", "/organization/emergency-stop", { cookie, body: { active: true, confirm: true } });
  check("engaging during a pending lift cancels the lift", !r.body.pending_changes?.some((p) => p.kind === "emergency_lift"), r.body);
  await sleep(3600);
  r = await call("GET", "/organization", { cookie });
  check("the cancelled lift never applies", r.body.emergency_stop === true, r.body);
  await call("POST", "/organization/emergency-stop", { cookie, body: { active: false, confirm: true } });
  await sleep(3600);
  r = await call("GET", "/organization", { cookie });
  check("an uncancelled lift applies after its delay", r.body.emergency_stop === false, r.body);

  // Alerts.
  await sleep(1500);
  const pendingHook = received.find((x) => x.type === "policy.loosening_pending" && x.body?.data?.kind === "policy_activation");
  check("webhook policy.loosening_pending carries the diff and effective_at", Array.isArray(pendingHook?.body?.data?.diff) && !!pendingHook?.body?.data?.effective_at, received.map((x) => x.type));
  check("webhook policy.loosening_applied fires", received.some((x) => x.type === "policy.loosening_applied"));
  check("webhook policy.loosening_cancelled fires", received.some((x) => x.type === "policy.loosening_cancelled"));
  const findings = await call("GET", "/security-events?refresh=1", { cookie });
  check("security event policy_loosening_pending is raised", findings.body.findings?.some((f) => f.category === "policy_loosening_pending"), findings.body.findings?.map((f) => f.category));

  // Concurrency: two activations racing.
  doc = { ...doc, limits: { ...doc.limits, max_transaction_value_wei: "1" } };
  const saved = await call("PUT", `/policies/${pol.id}`, { cookie, body: { document: doc } });
  const race = await Promise.all([1, 2, 3].map(() => call("POST", `/policies/${pol.id}/activate`, { cookie, body: { confirm: true, draft_hash: saved.body.draft_hash } })));
  const ok = race.filter((x) => x.status === 200).length;
  const p = await call("GET", `/policies/${pol.id}`, { cookie });
  check(`racing activations: exactly one wins (${ok} of 3), one active version`, ok === 1 && race.filter((x) => x.status === 409).length === 2 && typeof p.body.active_version === "number", race.map((x) => x.status));
  server.close();
}

// ================================================================ Part 2: asset safety on a mainnet fork
async function assetsPart() {
  const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const CHAIN = 4663;
  const art = (f, n) => JSON.parse(readFileSync(new URL(`../../../contracts/out/${f}/${n}.json`, import.meta.url), "utf8"));
  // anvil's well-known development accounts (public test keys, fork only).
  const deployer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const agentAcct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const chain = { id: CHAIN, name: "fork", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const w = (account) => createWalletClient({ account, chain, transport: http(RPC) });
  await pub.request({ method: "anvil_setBalance", params: [agentAcct.address, "0x56BC75E2D63100000"] });
  const deploy = async (f, n, args) => {
    const a = art(f, n);
    const hash = await w(deployer).deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
    return (await pub.waitForTransactionReceipt({ hash })).contractAddress;
  };
  const send = async (account, address, abi, functionName, args) => {
    const hash = await w(account).writeContract({ address, abi, functionName, args });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${functionName} failed`);
  };
  const K = "AssetTestKit.sol";
  const kitAbi = art(K, "KitToken").abi;
  const E18 = 10n ** 18n;
  const USD = await deploy(K, "KitToken", ["Test USD", "TUSD", 10n ** 30n]);
  const NORMAL = await deploy(K, "KitToken", ["Normal", "NORM", 10n ** 30n]);
  const HONEY = await deploy(K, "HoneypotToken", [10n ** 30n]);
  const TAX = await deploy(K, "TaxToken", [10n ** 30n]);
  const ROUTER = await deploy(K, "KitRouter", []);
  for (const t of [NORMAL, HONEY, TAX]) {
    const pair = await deploy(K, "KitPair", [USD, t]);
    await send(deployer, t, kitAbi, "setPair", [pair]);
    await send(deployer, USD, kitAbi, "transfer", [pair, 1_000_000n * E18]);
    await send(deployer, t, kitAbi, "transfer", [pair, 1_000_000n * E18]);
    await send(deployer, pair, art(K, "KitPair").abi, "sync", []);
    await send(deployer, ROUTER, art(K, "KitRouter").abi, "setPair", [USD, t, pair]);
  }
  await send(deployer, USD, kitAbi, "transfer", [agentAcct.address, 10_000n * E18]);
  await send(agentAcct, USD, kitAbi, "approve", [ROUTER, maxUint256]); // standing approval, set up before the test
  check("test kit deployed on the mainnet fork (USD, normal, honeypot, 20% tax, pairs, router)", true);

  const owner = privateKeyToAccount(generatePrivateKey());
  const cookie = await signIn(owner, CHAIN);
  const pol = await policyFor(cookie, "phase6_assets", CHAIN, agentAcct.address, (d) => ({
    ...d,
    limits: { ...d.limits, max_price_age_seconds: 600, max_pending_operations: 50, max_gas_cost_wei: "1000000000000000000" },
    cooldowns: { identical_calldata_seconds: 0, identical_intent_seconds: 0 },
    contracts: { default: "deny", allowlist: [{ address: ROUTER, selectors: ["0x38ed1739"], require_verified_code: false }, { address: USD, selectors: ["0x095ea7b3"], require_verified_code: false }], denylist: [] },
    human_approval: { usd_threshold_micros: "999999999999", require_for_unknown_methods: false },
  }));
  check("asset-safety policy (defaults: 5% tax, sell leg, no unlimited approvals, deny without simulation)", pol.act.body.active_document?.asset_safety?.enabled === true, pol.act.body);
  const agent = await call("POST", "/agents", { cookie, body: { name: "Asset agent", chain_id: CHAIN, account: agentAcct.address, policy_id: pol.id } });
  const key = (await call("POST", `/agents/${agent.body.id}/credentials`, { cookie, body: {} })).body.secret;
  const routerAbi = parseAbi(["function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])"]);
  const swap = (token, amountIn) => encodeFunctionData({ abi: routerAbi, functionName: "swapExactTokensForTokens", args: [amountIn, 0n, [USD, token], agentAcct.address, BigInt(now() + 600)] });
  const ev = (body, base = BASE) =>
    call("POST", "/authorizations/evaluate", { key, base, body: { request_id: `a-${crypto.randomUUID()}`, chain_id: CHAIN, value_wei: "0", gas_limit: 300000, deadline: now() + 120, ...body } });
  const asset = (r) => r.body.checks?.find((c) => c.id === "asset");
  const lc = (a) => a.toLowerCase();

  let r = await ev({ to: ROUTER, data: swap(NORMAL, E18), asset_intent: { spend: [{ token: USD, amount: E18.toString() }] } });
  check("normal token buy is allowed, with the simulation's numbers in the check", r.body.decision === "ALLOW" && /tax 0\.00%/.test(asset(r)?.detail) && /round-trip loss 0\.\d\d%/.test(asset(r)?.detail), [r.body.reason_code, asset(r)?.detail]);
  console.log(`      asset check: ${asset(r)?.detail}`);
  r = await ev({ to: ROUTER, data: swap(HONEY, E18), asset_intent: { spend: [{ token: USD, amount: E18.toString() }] } });
  check("honeypot (sell reverts) -> PS_ASSET_001", r.body.reason_code === "PS_ASSET_001", [r.body.reason_code, r.body.message]);
  r = await ev({ to: ROUTER, data: swap(TAX, E18), asset_intent: { spend: [{ token: USD, amount: E18.toString() }] } });
  check("20% sell-tax token -> PS_ASSET_002", r.body.reason_code === "PS_ASSET_002" && /20\.00%/.test(r.body.message), [r.body.reason_code, r.body.message]);
  r = await ev({ to: ROUTER, data: swap(NORMAL, 2n * E18), asset_intent: { spend: [{ token: USD, amount: E18.toString() }] } });
  check("swap that pulls more than declared -> PS_ASSET_003", r.body.reason_code === "PS_ASSET_003", [r.body.reason_code, r.body.message]);
  r = await ev({ to: ROUTER, data: swap(NORMAL, E18), asset_intent: { spend: [{ token: USD, amount: E18.toString() }], receive: [{ token: NORMAL, amount: (2n * E18).toString() }] } });
  check("receiving far below the quote -> PS_ASSET_003", r.body.reason_code === "PS_ASSET_003", [r.body.reason_code, r.body.message]);
  const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: ["0x9999999999999999999999999999999999999999", maxUint256] });
  r = await ev({ to: USD, data: approve });
  check("unlimited approval to an unknown spender -> PS_APPROVAL_001", r.body.reason_code === "PS_APPROVAL_001", [r.body.reason_code, r.body.message]);
  r = await ev({ to: USD, data: approve, asset_intent: { spend: [{ token: USD, amount: maxUint256.toString() }] } });
  check("an unlimited approval is refused even when declared", r.body.reason_code === "PS_APPROVAL_001", r.body.reason_code);
  const exact = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: ["0x9999999999999999999999999999999999999999", 5n * E18] });
  r = await ev({ to: USD, data: exact, asset_intent: { spend: [{ token: USD, amount: (5n * E18).toString() }] } });
  check("an exact, declared approval is allowed", r.body.decision === "ALLOW", [r.body.reason_code, r.body.message]);
  r = await ev({ to: lc(USD), data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROUTER, maxUint256] }) });
  check("unlimited approval to an allowlisted spender (the router) is allowed", r.body.decision === "ALLOW", [r.body.reason_code, r.body.message]);

  // Latency on the fork (the live-RPC numbers are measured separately).
  const times = [];
  for (let i = 0; i < 10; i++) times.push((await ev({ to: ROUTER, data: swap(NORMAL, E18), asset_intent: { spend: [{ token: USD, amount: E18.toString() }] } })).ms);
  times.sort((a, b) => a - b);
  console.log(`      decision latency with simulation on the fork: p50 ${times[5]} ms, max ${times[9]} ms`);

  if (OFF) {
    r = await ev({ to: ROUTER, data: swap(NORMAL, E18), asset_intent: { spend: [{ token: USD, amount: E18.toString() }] } }, OFF);
    check("simulator off -> PS_SIM_001, denied", r.body.decision === "DENY" && r.body.reason_code === "PS_SIM_001", [r.body.decision, r.body.reason_code]);
    const review = { ...pol.act.body.active_document, asset_safety: { ...pol.act.body.active_document.asset_safety, on_simulation_unavailable: "review" } };
    const a = await activate(cookie, pol.id, review);
    check("switching to review is itself a loosening (pending)", a.body.state === "pending_activation", a.body.state);
    await sleep(3600);
    r = await ev({ to: ROUTER, data: swap(NORMAL, E18), asset_intent: { spend: [{ token: USD, amount: E18.toString() }] } }, OFF);
    check("simulator off with on_simulation_unavailable=review -> held for a human (PS_SIM_001)", r.body.decision === "REQUIRES_HUMAN_SIGNATURE" && r.body.reason_code === "PS_SIM_001", [r.body.decision, r.body.reason_code]);
  }
}

if (PART === "delay") await delayPart();
else await assetsPart();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
