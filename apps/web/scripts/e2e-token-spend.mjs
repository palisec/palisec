#!/usr/bin/env node
/**
 * Spend limits that count tokens, on mainnet with tiny amounts, on the loss-limit demo smart account
 * (created by proof-loss.mjs; its keys and state stay in files outside the repository and are never
 * printed). Stages that send a transaction say so and need --send.
 *
 *   status                   balances, the router allowance and the active policy's limits
 *   policy                   turn on token_spend (schema 1.5): $0.30 per transaction, $0.70 an hour (a tightening: applies at once)
 *   allow-unpriced           allowlist approve() on a token with no Chainlink feed (a loosening: waits the delay)
 *   loss off|on              switch this demo's loss limit off (with allow-unpriced; a loosening: waits the delay) or back on (applies at once)
 *   approve <micros> [--send] agent: approve the router for exactly <micros> USDG (counted while it stays open)
 *   swap <micros> [--send]   agent: swap <micros> USDG -> WETH through the Safe (co-signed)
 *   try <micros>             agent: a recorded USDG -> WETH swap request only; prints the decision, checks the Safe's
 *                            nonce did not move, saves the signed receipt
 *   try-unpriced             agent: a recorded approve() of the token with no feed; expects DENY PS_PRICE_001
 *
 *   node apps/web/scripts/e2e-token-spend.mjs <stage> [arg] [--send]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createPublicClient, encodeFunctionData, formatEther, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createPalisec } from "../../../packages/sdk/dist/index.js";

const BASE = process.env.BASE_URL ?? "https://palisec.tech";
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const UNPRICED = "0x1B4d04c8A67bf98BdF791EF928482bcB225d71AB"; // $PALISEC: no Chainlink feed
const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const APPROVE = "0x095ea7b3";

const dir = `${homedir()}/palisec-pg`;
const keys = JSON.parse(readFileSync(`${dir}/loss-demo-keys.json`, "utf8"));
const statePath = `${dir}/loss-demo-state.json`;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
const owner = privateKeyToAccount(keys.owner);
const agentKey = privateKeyToAccount(keys.agent);
const [stage, arg] = process.argv.slice(2).filter((a) => a !== "--send");
const SEND = process.argv.includes("--send");
const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const utc = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const ERC20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
const ROUTER_ABI = parseAbi(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)"]);
const QUOTER_ABI = parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256,uint160,uint32,uint256)"]);
const QUOTER = "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7";

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
const usd = (micros) => `$${(Number(micros) / 1e6).toFixed(2)}`;
const palisec = () => createPalisec({ apiKey: state.api_key, chainId: 4663, baseUrl: `${BASE}/api/v1` });
const nonce = () => pub.readContract({ address: ENTRY_POINT, abi: parseAbi(["function getNonce(address,uint192) view returns (uint256)"]), functionName: "getNonce", args: [state.safe, 0n] });
const swapData = (amountIn, minOut) =>
  encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn: USDG, tokenOut: WETH, fee: 100, recipient: state.safe, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] });
const quote = async (amountIn) =>
  (await pub.simulateContract({ address: QUOTER, abi: QUOTER_ABI, functionName: "quoteExactInputSingle", args: [{ tokenIn: USDG, tokenOut: WETH, amountIn, fee: 100, sqrtPriceLimitX96: 0n }] })).result[0];
const spendDetail = (checks) => checks?.find((c) => c.id === "spend")?.detail ?? "";
const budgetDetail = (checks) => checks?.find((c) => c.id === "budget")?.detail ?? "";

async function execute(to, data, gasLimit = 300000) {
  const p = palisec();
  const { operation, execution } = await p.executeWithSmartAccount(agentKey, { to, value: 0n, data, gasLimit });
  let ex = execution;
  const until = Date.now() + 180_000;
  while (ex?.status === "submitted" && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000));
    ex = await p.getExecution(operation.operationId);
  }
  const op = (await call("GET", `/operations/${operation.operationId}`, { key: state.api_key })).body;
  console.log(`${utc()}  decision ${operation.operationId} ${operation.decision} ${operation.reasonCode ?? ""} → ${ex?.status ?? "not executed"} ${ex?.transactionHash ? `${EXPLORER}/tx/${ex.transactionHash}` : ""}`);
  console.log(`  spend: ${spendDetail(op.checks)}\n  budget: ${budgetDetail(op.checks)}`);
  return { operation, execution: ex };
}

/** A decision request only: nothing is executed. */
async function request(to, data, assetIntent, tag) {
  const before = await nonce();
  const r = await call("POST", "/operations", { key: state.api_key, body: { request_id: `spend-${tag}-${Date.now()}`, chain_id: 4663, to, value_wei: "0", data, ...(assetIntent ? { asset_intent: assetIntent } : {}), gas_limit: 300000, deadline: Math.floor(Date.now() / 1000) + 300 } });
  const after = await nonce();
  const file = `receipt-spend-${tag}.json`;
  if (r.body.receipt) writeFileSync(`${dir}/${file}`, JSON.stringify(r.body.receipt, null, 2));
  console.log(`${utc()}  decision ${r.body.operation_id} ${r.body.decision} ${r.body.reason_code ?? ""}: ${r.body.message}`);
  console.log(`  spend: ${spendDetail(r.body.checks)}\n  smart account nonce ${before} -> ${after}: ${before === after ? "nothing reached the chain" : "CHANGED"}${r.body.receipt ? `\n  signed receipt saved outside the repository (${file})` : ""}`);
  return r.body;
}

if (stage === "status") {
  const [eth, usdg, weth, allowance] = await Promise.all([
    pub.getBalance({ address: state.safe }),
    pub.readContract({ address: USDG, abi: ERC20, functionName: "balanceOf", args: [state.safe] }),
    pub.readContract({ address: WETH, abi: ERC20, functionName: "balanceOf", args: [state.safe] }),
    pub.readContract({ address: USDG, abi: ERC20, functionName: "allowance", args: [state.safe, ROUTER] }),
  ]);
  console.log(`${utc()}  Safe ${state.safe}: ${formatEther(eth)} ETH, ${Number(usdg) / 1e6} USDG, ${formatEther(weth)} WETH; USDG allowance to the router ${Number(allowance) / 1e6}`);
  const cookie = await signIn();
  const p = (await call("GET", `/policies/${state.policy_id}`, { cookie })).body;
  const d = p.active_document;
  console.log(`  active v${p.active_version ?? d?.version}: schema ${d?.schema_version}, hourly budget ${usd(d?.limits?.hourly_budget_usd_micros)}, approval at ${usd(d?.human_approval?.usd_threshold_micros)}, token_spend ${JSON.stringify(d?.token_spend ?? null)}, loss limit ${d?.loss_limit?.enabled ? "on" : "off"}`);
  if (p.pending) console.log(`  pending: ${JSON.stringify(p.pending)}`);
} else if (stage === "policy" || stage === "allow-unpriced" || stage === "loss") {
  const cookie = await signIn();
  const p = (await call("GET", `/policies/${state.policy_id}`, { cookie })).body;
  const doc = JSON.parse(JSON.stringify(p.active_document));
  delete doc.version;
  delete doc.status;
  if (stage === "policy") {
    doc.schema_version = "1.5";
    doc.limits.hourly_budget_usd_micros = "700000";
    doc.token_spend = { enabled: true, max_transaction_usd_micros: "300000", on_price_unavailable: "deny", max_closed_market_price_age_seconds: 259200, require_output_to_account: true };
  } else if (stage === "loss") {
    doc.loss_limit.enabled = arg === "on";
    if (arg === "off" && !doc.contracts.allowlist.some((e) => e.address.toLowerCase() === UNPRICED.toLowerCase()))
      doc.contracts.allowlist.push({ address: UNPRICED, selectors: [APPROVE], require_verified_code: true });
  } else {
    doc.contracts.allowlist = doc.contracts.allowlist.filter((e) => e.address.toLowerCase() !== UNPRICED.toLowerCase());
    doc.contracts.allowlist.push({ address: UNPRICED, selectors: [APPROVE], require_verified_code: true });
  }
  const s = await call("PUT", `/policies/${state.policy_id}`, { cookie, body: { document: doc } });
  if (s.status >= 300) throw new Error(`draft: HTTP ${s.status} ${JSON.stringify(s.body)}`);
  const a = await call("POST", `/policies/${state.policy_id}/activate`, { cookie, body: { confirm: true, draft_hash: s.body.draft_hash } });
  console.log(`${utc()}  ${stage}: HTTP ${a.status} v${a.body.activated_version ?? a.body.active_version ?? "?"} ${a.body.state ?? ""} ${a.body.effective_at ? `effective ${a.body.effective_at}` : ""} ${a.body.error ? JSON.stringify(a.body.error) : ""}`);
} else if (stage === "approve") {
  const amount = BigInt(arg);
  if (!needSend(`approve the router for ${Number(amount) / 1e6} USDG (one co-signed operation)`)) process.exit(0);
  await execute(USDG, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER, amount] }), 120000);
} else if (stage === "swap") {
  const amount = BigInt(arg);
  const q = await quote(amount);
  if (!needSend(`swap ${Number(amount) / 1e6} USDG -> about ${formatEther(q)} WETH through the Safe`)) process.exit(0);
  await execute(ROUTER, swapData(amount, (q * 97n) / 100n));
} else if (stage === "try") {
  const amount = BigInt(arg);
  const q = await quote(amount);
  const r = await request(ROUTER, swapData(amount, (q * 97n) / 100n), { spend: [{ token: USDG, amount: amount.toString() }], receive: [{ token: WETH, amount: q.toString() }] }, `try-${amount}`);
  state.spend_tries = [...(state.spend_tries ?? []), { amount: amount.toString(), operation_id: r.operation_id, decision: r.decision, reason_code: r.reason_code }];
  save();
} else if (stage === "try-unpriced") {
  const r = await request(UNPRICED, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER, 10n ** 18n] }), { spend: [{ token: UNPRICED, amount: (10n ** 18n).toString() }], receive: [] }, "unpriced");
  Object.assign(state, { spend_unpriced: { operation_id: r.operation_id, reason_code: r.reason_code } });
  save();
} else {
  console.log("stages: status | policy | allow-unpriced | approve <micros> | swap <micros> | try <micros> | try-unpriced");
}
