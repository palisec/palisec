#!/usr/bin/env node
/**
 * Treasury guard mainnet demo, on the loss-limits demo smart account (it holds a small amount of $PALISEC).
 * Keys and state stay in files outside the repository; keys are never printed. Stages that send a
 * transaction say so and need --send.
 *
 *   status                     balances, the active policy's treasury guard, pending changes
 *   prep                       allowlist $PALISEC and the Pons curve, token spend off (no price feed for
 *                              $PALISEC), schema 1.6: a loosening, so it waits out the delay
 *   approve <tokens> [--send]  agent: approve exactly <tokens> $PALISEC to the Pons curve (co-signed)
 *   guard                      turn the treasury guard on: Pons curve only, 2,000 a day, locked 30 days (applies at once)
 *   insider                    agent: send 1 $PALISEC to a fresh wallet; expects DENY PS_TREASURY_001, nothing on chain
 *   unlimited                  agent: an unlimited approval to the curve; expects DENY PS_TREASURY_003
 *   sell <tokens> [--send]     agent: sell <tokens> on the Pons curve (co-signed)
 *   try-sell <tokens>          agent: a recorded sell request; over the cap expects DENY PS_TREASURY_002
 *   loosen                     owner: try to raise the cap before the lock date; expects 422 PS_TREASURY_005
 *
 *   node apps/web/scripts/proof-treasury.mjs <stage> [arg] [--send]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createPublicClient, encodeFunctionData, formatUnits, http, maxUint256, parseAbi, parseUnits } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPalisec } from "../../../packages/sdk/dist/index.js";

const BASE = process.env.BASE_URL ?? "https://palisec.tech";
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const PALISEC = "0x1B4d04c8A67bf98BdF791EF928482bcB225d71AB";
const CURVE = "0x9f7383a2fcb30124A203D359e7a403F750a56501";
const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const APPROVE = "0x095ea7b3";
const TRANSFER = "0xa9059cbb";
const SELL = "0xd04c6983"; // sell(uint256 tokensIn, uint256 minQuoteOut, address recipient)
const CAP_TOKENS = 2000n;
const LOCK_DAYS = 30;

const dir = `${homedir()}/palisec-pg`;
const keys = JSON.parse(readFileSync(`${dir}/loss-demo-keys.json`, "utf8"));
const statePath = `${dir}/loss-demo-state.json`;
const proofPath = `${dir}/treasury-proof.json`;
const owner = privateKeyToAccount(keys.owner);
const agentKey = privateKeyToAccount(keys.agent);
const state = JSON.parse(readFileSync(statePath, "utf8"));
const proof = existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, "utf8")) : {};
const saveProof = () => writeFileSync(proofPath, JSON.stringify(proof, null, 2));
const [stage, arg] = process.argv.slice(2).filter((a) => a !== "--send");
const SEND = process.argv.includes("--send");
const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const utc = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const ERC20 = parseAbi(["function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
const CURVE_ABI = parseAbi(["function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient)"]);
const tokens = (n) => parseUnits(String(n), 18);

async function call(method, path, { cookie, key, body } = {}) {
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
const needSend = (what) => {
  if (SEND) return true;
  console.log(`${utc()}  preview: ${what}. Nothing sent; add --send to send it.`);
  return false;
};
const palisec = () => createPalisec({ apiKey: state.api_key, chainId: 4663, baseUrl: `${BASE}/api/v1` });
const nonce = () => pub.readContract({ address: ENTRY_POINT, abi: parseAbi(["function getNonce(address,uint192) view returns (uint256)"]), functionName: "getNonce", args: [state.safe, 0n] });

async function execute(label, to, data, gasLimit = 300000) {
  const p = palisec();
  const { operation, execution } = await p.executeWithSmartAccount(agentKey, { to, value: 0n, data, gasLimit });
  let ex = execution;
  const until = Date.now() + 180_000;
  while (ex?.status === "submitted" && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000));
    ex = await p.getExecution(operation.operationId);
  }
  const tx = ex?.transactionHash ? `${EXPLORER}/tx/${ex.transactionHash}` : null;
  console.log(`${utc()}  ${label}: decision ${operation.operationId} ${operation.decision} ${operation.reasonCode ?? ""} → ${ex?.status ?? "not executed"} ${tx ?? ""}`);
  proof[label] = { at: utc(), operation_id: operation.operationId, decision: operation.decision, reason_code: operation.reasonCode ?? null, status: ex?.status ?? null, tx };
  saveProof();
}

/** A recorded request that is expected to be denied: shows the decision, the receipt, and that nothing reached the chain. */
async function attempt(label, to, data) {
  const before = await nonce();
  const r = await call("POST", "/operations", { key: state.api_key, body: { request_id: `treasury-${label}-${Date.now()}`, chain_id: 4663, to, value_wei: "0", data, gas_limit: 300000, deadline: Math.floor(Date.now() / 1000) + 300 } });
  const after = await nonce();
  if (r.body.receipt) writeFileSync(`${dir}/receipt-treasury-${label}.json`, JSON.stringify(r.body.receipt, null, 2));
  proof[label] = { at: utc(), operation_id: r.body.operation_id, decision: r.body.decision, reason_code: r.body.reason_code ?? null, message: r.body.message, nonce_unchanged: before === after, receipt: Boolean(r.body.receipt) };
  saveProof();
  console.log(`${utc()}  ${label}: decision ${r.body.operation_id} ${r.body.decision} ${r.body.reason_code ?? ""}: ${r.body.message}\n  smart account nonce ${before} -> ${after}: ${before === after ? "nothing reached the chain" : "CHANGED"}${r.body.receipt ? " · signed receipt saved" : ""}`);
}

async function activeDoc(cookie) {
  const p = await call("GET", `/policies/${state.policy_id}`, { cookie });
  return p.body;
}
async function activate(cookie, doc, label) {
  const s = await call("PUT", `/policies/${state.policy_id}`, { cookie, body: { document: doc } });
  if (s.body.draft_errors?.length) throw new Error(`draft invalid: ${JSON.stringify(s.body.draft_errors)}`);
  const a = await call("POST", `/policies/${state.policy_id}/activate`, { cookie, body: { confirm: true, draft_hash: s.body.draft_hash } });
  const pending = a.body.pending_change;
  console.log(`${utc()}  ${label}: HTTP ${a.status} ${a.body.error ? JSON.stringify(a.body.error) : pending ? `pending until ${pending.effective_at}` : `active v${a.body.active_version}`}`);
  proof[label] = { at: utc(), http: a.status, error: a.body.error ?? null, active_version: a.body.active_version ?? null, pending_until: pending?.effective_at ?? null };
  saveProof();
  return a;
}

if (stage === "status") {
  const cookie = await signIn();
  const [bal, allowance, d] = await Promise.all([
    pub.readContract({ address: PALISEC, abi: ERC20, functionName: "balanceOf", args: [state.safe] }),
    pub.readContract({ address: PALISEC, abi: ERC20, functionName: "allowance", args: [state.safe, CURVE] }),
    activeDoc(cookie),
  ]);
  const pend = await call("GET", "/pending-changes", { cookie });
  console.log(`${utc()}  account ${state.safe}\n  $PALISEC ${formatUnits(bal, 18)} · allowance to the curve ${formatUnits(allowance, 18)} · ETH ${formatUnits(await pub.getBalance({ address: state.safe }), 18)}`);
  console.log(`  active v${d.active_version} schema ${d.active_document?.schema_version} · treasury_guard ${JSON.stringify(d.active_document?.treasury_guard ?? null)}`);
  console.log(`  pending: ${JSON.stringify((pend.body.pending ?? []).map((c) => ({ kind: c.kind, effective_at: c.effective_at })))}`);
} else if (stage === "prep") {
  const cookie = await signIn();
  const d = await activeDoc(cookie);
  const doc = structuredClone(d.active_document);
  doc.schema_version = "1.6";
  delete doc.token_spend; // $PALISEC has no Chainlink feed, so the spend rule would deny every $PALISEC sell
  const add = [
    { address: PALISEC, selectors: [APPROVE, TRANSFER], require_verified_code: true },
    { address: CURVE, selectors: [SELL], require_verified_code: true },
  ];
  doc.contracts.allowlist = [...doc.contracts.allowlist.filter((e) => !add.some((x) => x.address.toLowerCase() === e.address.toLowerCase())), ...add];
  await activate(cookie, doc, "prep");
} else if (stage === "approve") {
  const n = tokens(arg);
  if (!needSend(`approve exactly ${arg} $PALISEC to the Pons curve`)) process.exit(0);
  await execute(`approve_${arg}`, PALISEC, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [CURVE, n] }), 120000);
} else if (stage === "guard") {
  const cookie = await signIn();
  const d = await activeDoc(cookie);
  const doc = structuredClone(d.active_document);
  const lockedUntil = Math.floor(Date.now() / 1000) + LOCK_DAYS * 86400;
  doc.treasury_guard = {
    enabled: true,
    project_token: PALISEC.toLowerCase(),
    allowed_destinations: [],
    allowed_sell_venues: [CURVE.toLowerCase()],
    daily_sell_cap: { amount: tokens(CAP_TOKENS).toString(), pct_of_holdings_bps: null },
    approvals: "exact_to_venues",
    protect_liquidity: false,
    lp_tokens: [],
    locked_until: lockedUntil,
  };
  await activate(cookie, doc, "guard");
  proof.guard_locked_until = new Date(lockedUntil * 1000).toISOString();
  saveProof();
} else if (stage === "insider") {
  const fresh = privateKeyToAccount(generatePrivateKey()).address;
  proof.insider_wallet = fresh;
  await attempt("insider", PALISEC, encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [fresh, tokens(1)] }));
} else if (stage === "unlimited") {
  await attempt("unlimited", PALISEC, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [CURVE, maxUint256] }));
} else if (stage === "sell") {
  if (!needSend(`sell ${arg} $PALISEC on the Pons curve`)) process.exit(0);
  await execute(`sell_${arg}`, CURVE, encodeFunctionData({ abi: CURVE_ABI, functionName: "sell", args: [tokens(arg), 1n, state.safe] }), 400000);
} else if (stage === "try-sell") {
  await attempt(`sell_over_${arg}`, CURVE, encodeFunctionData({ abi: CURVE_ABI, functionName: "sell", args: [tokens(arg), 1n, state.safe] }));
} else if (stage === "loosen") {
  const cookie = await signIn();
  const d = await activeDoc(cookie);
  const doc = structuredClone(d.active_document);
  doc.treasury_guard.daily_sell_cap = { amount: tokens(CAP_TOKENS * 5n).toString(), pct_of_holdings_bps: null };
  await activate(cookie, doc, "loosen");
} else {
  console.log("stages: status | prep | approve <tokens> | guard | insider | unlimited | sell <tokens> | try-sell <tokens> | loosen");
}
