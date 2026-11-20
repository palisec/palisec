#!/usr/bin/env node
/**
 * Phase 7 mainnet proof, in stages (state in PROOF_STATE, outside the repo; keys never printed):
 *   setup                 demo org, a Palisec smart account (Safe), its policy, agent and the demo mandate
 *   propose loosen|tighten  voter 1 opens a proposal (per-tx limit 0.0003 ETH, or back to 0.00001 ETH)
 *   vote <proposal-id>    the three voter wallets sign "for" (gasless)
 *   status                the public mandate as the page shows it
 *   send <wei>            the agent sends <wei> to the company wallet through the smart account
 *   try <wei>             the agent asks for <wei> (recorded decision); expects DENY, checks nothing reached the chain
 *   recount <proposal-id> independent recount of the published vote file
 *
 *   PROOF_STATE=… DEMO_KEYS=… VOTER_KEYS=… FUND_KEY=… node apps/web/scripts/proof-mandate.mjs <stage> [arg]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createPalisec } from "../../../packages/sdk/dist/index.js";

const BASE = "https://palisec.tech";
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const COMPANY = "0x989EfcD8Ad76E695CFD5ba915b1b12118471c430";
const ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2";
const FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const MODULE = "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226";
const MODULE_SETUP = "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47";
const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const ZERO = "0x0000000000000000000000000000000000000000";
const SLUG = process.env.MANDATE_SLUG ?? "palisec-demo";

const [stage, arg] = process.argv.slice(2);
const statePath = process.env.PROOF_STATE;
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
const demo = JSON.parse(readFileSync(process.env.DEMO_KEYS, "utf8"));
const owner = privateKeyToAccount(demo.owner);
const agentKey = privateKeyToAccount(demo.agent);
const voters = JSON.parse(readFileSync(process.env.VOTER_KEYS, "utf8")).keys.map((k) => privateKeyToAccount(k));
const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const utc = () => new Date().toISOString();

let previewCookie = null;
async function call(method, path, { cookie, key, body } = {}) {
  // Mandate pages are preview-only until go-live: their API needs a signed-in session.
  if (!cookie && !key && path.startsWith("/public/")) cookie = previewCookie ??= await signIn();
  const h = { origin: BASE };
  if (body !== undefined) h["content-type"] = "application/json";
  if (cookie) h.cookie = cookie;
  if (key) h.authorization = `Bearer ${key}`;
  const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
}
async function signIn() {
  const c = await call("POST", "/auth/challenges", { body: { address: owner.address, chain_id: 4663 } });
  const v = await call("POST", "/auth/verify", { body: { nonce: c.body.nonce, signature: await owner.signMessage({ message: c.body.message }) } });
  return (v.headers.get("set-cookie") ?? "").split(";")[0];
}
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v));
const send = async (account, tx) => {
  const w = createWalletClient({ account, chain, transport: http(RPC) });
  const hash = await w.sendTransaction(tx);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("transaction failed");
  return hash;
};

if (stage === "setup") {
  const cookie = await signIn();
  // Gas: the demo owner key receives a little ETH, creates the Safe and funds it.
  if (!state.funded) {
    const fund = privateKeyToAccount(JSON.parse(readFileSync(process.env.FUND_KEY, "utf8")).key);
    state.funded = await send(fund, { to: owner.address, value: 70_000_000_000_000n });
    console.log(`${utc()}  gas for the demo owner: ${EXPLORER}/tx/${state.funded}`);
    save();
  }
  if (!state.safe) {
    const cfg = await call("GET", "/smart-accounts?chain_id=4663", { cookie });
    const initializer = encodeFunctionData({
      abi: parseAbi(["function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)"]),
      functionName: "setup",
      args: [[agentKey.address, cfg.body.palisec_signer, COMPANY], 2n, MODULE_SETUP, encodeFunctionData({ abi: parseAbi(["function enableModules(address[] modules)"]), functionName: "enableModules", args: [[MODULE]] }), MODULE, ZERO, 0n, ZERO],
    });
    const abi = parseAbi(["function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)"]);
    const salt = BigInt(Date.now());
    const { result: safe } = await pub.simulateContract({ account: owner, address: FACTORY, abi, functionName: "createProxyWithNonce", args: [SINGLETON, initializer, salt] });
    const w = createWalletClient({ account: owner, chain, transport: http(RPC) });
    const hash = await w.writeContract({ address: FACTORY, abi, functionName: "createProxyWithNonce", args: [SINGLETON, initializer, salt] });
    await pub.waitForTransactionReceipt({ hash });
    state.safe = safe;
    state.safe_tx = hash;
    state.safe_funding = await send(owner, { to: safe, value: 50_000_000_000_000n });
    console.log(`${utc()}  Palisec smart account ${safe}: ${EXPLORER}/tx/${hash}; funded ${EXPLORER}/tx/${state.safe_funding}`);
    save();
  }
  if (!state.policy_id) {
    const p = await call("POST", "/policies", { cookie, body: { name: "Palisec demo agent (holder mandate)", policy_key: "palisec_demo_mandate", chain_id: 4663, account: state.safe } });
    const doc = {
      ...p.body.draft,
      limits: { ...p.body.draft.limits, max_transaction_value_wei: "10000000000000", hourly_budget_usd_micros: "1000000", max_price_age_seconds: 120, max_pending_operations: 3 },
      cooldowns: { identical_calldata_seconds: 0, identical_intent_seconds: 0 },
      contracts: { default: "deny", allowlist: [{ address: COMPANY, selectors: [], require_verified_code: false }], denylist: [] },
      human_approval: { usd_threshold_micros: "1000000", require_for_unknown_methods: false },
    };
    const s = await call("PUT", `/policies/${p.body.id}`, { cookie, body: { document: doc } });
    const a = await call("POST", `/policies/${p.body.id}/activate`, { cookie, body: { confirm: true, draft_hash: s.body.draft_hash } });
    state.policy_id = p.body.id;
    console.log(`${utc()}  policy v${a.body.active_version}: per-transaction 0.00001 ETH, hourly $1.00, approval at $1.00, allowlist: company wallet`);
    save();
  }
  if (!state.agent_id) {
    const ag = await call("POST", "/agents", { cookie, body: { name: "Palisec demo agent", chain_id: 4663, account: state.safe, policy_id: state.policy_id } });
    const k = await call("POST", `/agents/${ag.body.id}/credentials`, { cookie, body: { label: "mandate proof" } });
    state.agent_id = ag.body.id;
    state.api_key = k.body.secret;
    save();
  }
  if (!state.mandate_id) {
    const envelope = {
      max_transaction_value_wei: "300000000000000",
      max_hourly_budget_usd_micros: "2000000",
      min_approval_threshold_usd_micros: "500000",
      allowed_contracts: [{ address: COMPANY, selectors: [] }, { address: ROUTER, selectors: ["0x04e45aaf"] }],
    };
    const m = await call("POST", "/mandates", { cookie, body: { slug: SLUG, name: "Palisec demo agent: holder mandate", agent_id: state.agent_id, voting_period_seconds: 3600, quorum: "1000", pass_bps: 5000, proposer_min: "1", envelope, demo: true } });
    if (m.status !== 201) throw new Error(`mandate: ${JSON.stringify(m.body)}`);
    state.mandate_id = m.body.id;
    console.log(`${utc()}  mandate ${BASE}/m/${SLUG} (1-hour demo votes, quorum 1,000 $PALISEC, passes above 50%)`);
    save();
  }
  console.log("setup done");
} else if (stage === "propose") {
  const change = arg === "tighten" ? { kind: "set_max_transaction_value", wei: "10000000000000" } : { kind: "set_max_transaction_value", wei: "300000000000000" };
  const title = arg === "tighten" ? "Lower the per-transaction limit back to 0.00001 ETH" : "Raise the per-transaction limit to 0.0003 ETH";
  const nonce = `p${Date.now()}`;
  const signature = await voters[0].signTypedData({
    domain: { name: "Palisec Mandates", version: "1", chainId: 4663 },
    types: { Proposal: [{ name: "mandate", type: "string" }, { name: "title", type: "string" }, { name: "change", type: "string" }, { name: "nonce", type: "string" }] },
    primaryType: "Proposal",
    message: { mandate: SLUG, title, change: canonical(change), nonce },
  });
  const r = await call("POST", `/public/mandates/${SLUG}/proposals`, { body: { title, change, nonce, proposer: voters[0].address, signature } });
  console.log(`${utc()}  ${JSON.stringify(r.body)}`);
  if (r.status === 201) (state.proposals ??= []).push(r.body), save();
} else if (stage === "vote") {
  const p = state.proposals.find((x) => x.proposal_id === arg);
  for (const v of voters) {
    const signature = await v.signTypedData({
      domain: { name: "Palisec Mandates", version: "1", chainId: 4663 },
      types: { Vote: [{ name: "mandate", type: "string" }, { name: "proposalId", type: "string" }, { name: "choice", type: "uint8" }, { name: "snapshotBlock", type: "uint256" }] },
      primaryType: "Vote",
      message: { mandate: SLUG, proposalId: p.proposal_id, choice: 0, snapshotBlock: BigInt(p.snapshot_block) },
    });
    const r = await call("POST", `/public/mandates/${SLUG}/proposals/${p.proposal_id}/votes`, { body: { voter: v.address, choice: "for", signature } });
    console.log(`${utc()}  vote ${v.address} for: ${r.status} weight ${r.body.weight ?? JSON.stringify(r.body.error)}`);
  }
} else if (stage === "status") {
  const r = await call("GET", `/public/mandates/${SLUG}`);
  const b = r.body;
  console.log(`${utc()}  active v${b.active?.version} per-tx ${formatEther(BigInt(b.active?.max_transaction_value_wei ?? 0))} ETH since ${b.active?.since}`);
  for (const p of b.proposals) console.log(`  #${p.number} ${p.state} applied=${p.applied} pending=${JSON.stringify(p.pending)} for=${p.tally.for} quorum=${p.tally.quorum_reached} closes=${p.closes_at}`);
  for (const d of b.decisions.slice(0, 5)) console.log(`  decision ${d.id} ${d.decision} ${d.reason_code ?? ""} ${d.transaction_hash ?? ""}`);
} else if (stage === "send") {
  const palisec = createPalisec({ apiKey: state.api_key, chainId: 4663, baseUrl: `${BASE}/api/v1` });
  const { operation, execution } = await palisec.executeWithSmartAccount(agentKey, { to: COMPANY, value: BigInt(arg), data: "0x", gasLimit: 150000 });
  let ex = execution;
  const until = Date.now() + 180_000;
  while (ex.status === "submitted" && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000));
    ex = await palisec.getExecution(operation.operationId);
  }
  console.log(`${utc()}  decision ${operation.operationId} ${operation.decision} → execution ${ex.status} ${ex.transactionHash ? `${EXPLORER}/tx/${ex.transactionHash}` : ""}`);
} else if (stage === "try") {
  const nonce = () => pub.readContract({ address: ENTRY_POINT, abi: parseAbi(["function getNonce(address,uint192) view returns (uint256)"]), functionName: "getNonce", args: [state.safe, 0n] });
  const before = await nonce();
  const r = await call("POST", "/operations", { key: state.api_key, body: { request_id: `try-${Date.now()}`, chain_id: 4663, to: COMPANY, value_wei: arg, data: "0x", gas_limit: 150000, deadline: Math.floor(Date.now() / 1000) + 300 } });
  const after = await nonce();
  console.log(`${utc()}  decision ${r.body.operation_id} ${r.body.decision} ${r.body.reason_code ?? ""}: ${r.body.message}\n  smart account nonce ${before} -> ${after}: ${before === after ? "nothing reached the chain" : "CHANGED"}`);
} else if (stage === "recount") {
  const file = await call("GET", `/public/mandates/${SLUG}/proposals/${arg}/vote-file`);
  const path = join(tmpdir(), `vote-file-${arg}.json`);
  writeFileSync(path, JSON.stringify(file.body, null, 2));
  const rc = spawnSync(process.execPath, [fileURLToPath(new URL("./recount-mandate.mjs", import.meta.url)), path], { encoding: "utf8" });
  console.log(rc.stdout);
} else {
  console.log("stages: setup | propose loosen|tighten | vote <id> | status | send <wei> | try <wei> | recount <id>");
}
