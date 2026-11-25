#!/usr/bin/env node
/**
 * Loss limits mainnet demo, on a new demo smart account. Stages (state and keys in files outside
 * the repository; keys are never printed). Stages that send a transaction say so and need --send.
 *
 *   keys                    create the demo owner and agent keys (if missing); prints the owner address to fund
 *   org                     sign in as the demo owner (creates the demo organization), print its ID, set delays to 15 min
 *   safe [--send]           owner: create the Palisec smart account (Safe: agent key, Palisec co-signer, company wallet)
 *   fund [--send]           owner: send the Safe 0.0003 ETH and 1 USDG
 *   policy                  policy (no loss limit yet), agent and API key; allowlist: router, USDG, WETH, registry, company wallet
 *   declare [--send]        agent: the Safe declares Palisec in the policy registry (co-signed)
 *   limit                   turn on the loss limit: $0.005 over 24 h (a tightening: applies at once)
 *   buy <wei> [--send]      agent: swap ETH -> USDG through the Safe (co-signed)
 *   sell <micros> [--send]  agent: approve exactly, then swap USDG -> WETH through the Safe (two co-signed operations)
 *   try <micros>            agent: a recorded USDG -> WETH swap request (adds risk); expects DENY PS_LOSS_00x, checks the
 *                           Safe's nonce did not move, saves the signed receipt
 *   exit <micros> [--send]  agent: USDG back to the company wallet (allowed while paused)
 *   reset                   owner: request the reset (pending, countdown)
 *   status                  the loss limit as the console shows it, and the registry's view
 *   sync                    publish the account's commitments now (registry)
 *
 *   node apps/web/scripts/proof-loss.mjs <stage> [arg] [--send]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, http, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPalisec } from "../../../packages/sdk/dist/index.js";
import { REGISTRY_V1_ABI as REGISTRY_ABI, REGISTRY_V1_ADDRESSES as REGISTRY_ADDRESSES, readAccount } from "../../../packages/policy-enforced-accounts/dist/index.js";

const BASE = process.env.BASE_URL ?? "https://palisec.tech";
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const COMPANY = "0x989EfcD8Ad76E695CFD5ba915b1b12118471c430";
const ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const REGISTRY = REGISTRY_ADDRESSES[4663];
const DECLARE = "0x98c5fdc5";
const COSIGNER = "0x628FdA166280b9E2C5E5FBD89fDDDaCe626d8ec7";
const FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const MODULE = "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226";
const MODULE_SETUP = "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47";
const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const ZERO = "0x0000000000000000000000000000000000000000";
const SWAP = "0x04e45aaf";
const APPROVE = "0x095ea7b3";
const TRANSFER = "0xa9059cbb";

const dir = `${homedir()}/palisec-pg`;
const keysPath = `${dir}/loss-demo-keys.json`;
const statePath = `${dir}/loss-demo-state.json`;
const [stage, arg] = process.argv.slice(2).filter((a) => a !== "--send");
const SEND = process.argv.includes("--send");
if (stage === "keys" && !existsSync(keysPath)) writeFileSync(keysPath, JSON.stringify({ owner: generatePrivateKey(), agent: generatePrivateKey() }));
const keys = JSON.parse(readFileSync(keysPath, "utf8"));
const owner = privateKeyToAccount(keys.owner);
const agentKey = privateKeyToAccount(keys.agent);
const registryKeys = JSON.parse(readFileSync(`${dir}/registry-keys.json`, "utf8"));
const publisher = privateKeyToAccount(registryKeys.publisher).address;
const receiptSigner = privateKeyToAccount(registryKeys.receipt).address;
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const utc = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const ERC20 = parseAbi(["function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
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
const gasNote = async (tx) => {
  const [gas, price] = await Promise.all([pub.estimateGas({ account: owner, ...tx }).catch(() => 200000n), pub.getGasPrice()]);
  return `about ${formatEther(gas * price)} ETH gas`;
};
const palisec = () => createPalisec({ apiKey: state.api_key, chainId: 4663, baseUrl: `${BASE}/api/v1` });
async function execute(to, value, data, gasLimit = 300000) {
  const p = palisec();
  const { operation, execution } = await p.executeWithSmartAccount(agentKey, { to, value, data, gasLimit });
  let ex = execution;
  const until = Date.now() + 180_000;
  while (ex?.status === "submitted" && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000));
    ex = await p.getExecution(operation.operationId);
  }
  console.log(`${utc()}  decision ${operation.operationId} ${operation.decision} ${operation.reasonCode ?? ""} → ${ex?.status ?? "not executed"} ${ex?.transactionHash ? `${EXPLORER}/tx/${ex.transactionHash}` : ""}`);
  return { operation, execution: ex };
}
const swapData = (tokenIn, tokenOut, amountIn, minOut) =>
  encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn, tokenOut, fee: 100, recipient: state.safe, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] });
const quote = async (tokenIn, tokenOut, amountIn) =>
  (await pub.simulateContract({ address: QUOTER, abi: QUOTER_ABI, functionName: "quoteExactInputSingle", args: [{ tokenIn, tokenOut, amountIn, fee: 100, sqrtPriceLimitX96: 0n }] })).result[0];

if (stage === "keys") {
  console.log(`demo owner (fund this from the company wallet): ${owner.address}\ndemo agent key address: ${agentKey.address}`);
} else if (stage === "org") {
  const cookie = await signIn();
  const me = await call("GET", "/me", { cookie });
  state.org_id = me.body.organizations?.[0]?.id ?? me.body.memberships?.[0]?.org_id ?? me.body.org_id;
  save();
  const d = await call("POST", "/organization/delays", { cookie, body: { confirm: true, loosening_delay_seconds: 900, stop_lift_delay_seconds: 900 } });
  const pend = (await call("GET", "/pending-changes", { cookie })).body;
  console.log(`${utc()}  demo organization ${state.org_id}; delays → 15 min: HTTP ${d.status}; pending: ${JSON.stringify((pend.changes ?? pend.items ?? pend).map?.((c) => ({ kind: c.kind, effective_at: c.effective_at })) ?? pend)}`);
} else if (stage === "safe") {
  if (state.safe) throw new Error(`already created: ${state.safe}`);
  const cookie = await signIn();
  const cfg = await call("GET", "/smart-accounts?chain_id=4663", { cookie });
  const initializer = encodeFunctionData({
    abi: parseAbi(["function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)"]),
    functionName: "setup",
    args: [[agentKey.address, cfg.body.palisec_signer, COMPANY], 2n, MODULE_SETUP, encodeFunctionData({ abi: parseAbi(["function enableModules(address[] modules)"]), functionName: "enableModules", args: [[MODULE]] }), MODULE, ZERO, 0n, ZERO],
  });
  const abi = parseAbi(["function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)"]);
  const salt = BigInt(Date.now());
  const { result: safe } = await pub.simulateContract({ account: owner, address: FACTORY, abi, functionName: "createProxyWithNonce", args: [SINGLETON, initializer, salt] });
  const data = encodeFunctionData({ abi, functionName: "createProxyWithNonce", args: [SINGLETON, initializer, salt] });
  if (!needSend(`create Safe ${safe} (owners: agent, Palisec co-signer ${cfg.body.palisec_signer}, company wallet; 2 of 3), ${await gasNote({ to: FACTORY, data })}`)) process.exit(0);
  const w = createWalletClient({ account: owner, chain, transport: http(RPC) });
  const hash = await w.sendTransaction({ to: FACTORY, data });
  await pub.waitForTransactionReceipt({ hash });
  Object.assign(state, { safe, safe_tx: hash });
  save();
  console.log(`${utc()}  Palisec smart account ${safe}: ${EXPLORER}/tx/${hash}`);
} else if (stage === "fund") {
  const eth = 300_000_000_000_000n;
  const usdg = 1_000_000n;
  if (!needSend(`send the Safe ${formatEther(eth)} ETH and ${Number(usdg) / 1e6} USDG from the demo owner, ${await gasNote({ to: state.safe, value: eth })} each`)) process.exit(0);
  const w = createWalletClient({ account: owner, chain, transport: http(RPC) });
  const a = await w.sendTransaction({ to: state.safe, value: eth });
  await pub.waitForTransactionReceipt({ hash: a });
  const b = await w.writeContract({ address: USDG, abi: ERC20, functionName: "transfer", args: [state.safe, usdg] });
  await pub.waitForTransactionReceipt({ hash: b });
  Object.assign(state, { fund_eth_tx: a, fund_usdg_tx: b });
  save();
  console.log(`${utc()}  funded: ${EXPLORER}/tx/${a} · ${EXPLORER}/tx/${b}`);
} else if (stage === "policy") {
  const cookie = await signIn();
  const p = await call("POST", "/policies", { cookie, body: { name: "Palisec loss-limit demo", policy_key: "palisec_loss_demo", chain_id: 4663, account: state.safe } });
  const doc = {
    ...p.body.draft,
    schema_version: "1.3",
    token_spend: undefined, // new drafts carry token spend (schema 1.5); this test pins an older version
    limits: { ...p.body.draft.limits, max_transaction_value_wei: "500000000000000", hourly_budget_usd_micros: "5000000", max_price_age_seconds: 120, max_pending_operations: 3 },
    cooldowns: { identical_calldata_seconds: 0, identical_intent_seconds: 0 },
    contracts: {
      default: "deny",
      allowlist: [
        { address: ROUTER, selectors: [SWAP], require_verified_code: true },
        { address: USDG, selectors: [APPROVE, TRANSFER], require_verified_code: true },
        { address: WETH, selectors: [APPROVE, TRANSFER], require_verified_code: true },
        { address: REGISTRY, selectors: [DECLARE], require_verified_code: true },
        { address: COMPANY, selectors: [], require_verified_code: false },
      ],
      denylist: [],
    },
    human_approval: { usd_threshold_micros: "5000000", require_for_unknown_methods: false },
  };
  const s = await call("PUT", `/policies/${p.body.id}`, { cookie, body: { document: doc } });
  const a = await call("POST", `/policies/${p.body.id}/activate`, { cookie, body: { confirm: true, draft_hash: s.body.draft_hash } });
  const ag = await call("POST", "/agents", { cookie, body: { name: "Palisec loss-limit demo agent", chain_id: 4663, account: state.safe, policy_id: p.body.id } });
  const k = await call("POST", `/agents/${ag.body.id}/credentials`, { cookie, body: { label: "loss-limit proof" } });
  Object.assign(state, { policy_id: p.body.id, agent_id: ag.body.id, api_key: k.body.secret, base_doc: doc });
  save();
  console.log(`${utc()}  policy v${a.body.active_version} (${a.body.state}), agent ${ag.body.id}`);
} else if (stage === "declare") {
  const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: "declare", args: [COSIGNER, publisher, receiptSigner] });
  if (!needSend("the Safe declares Palisec in the registry (one co-signed operation, gas from the Safe)")) process.exit(0);
  await execute(REGISTRY, 0n, data, 200000);
} else if (stage === "limit") {
  const cookie = await signIn();
  const doc = {
    ...state.base_doc,
    loss_limit: {
      enabled: true, max_drawdown_bps: 0, max_loss_usd_micros: "5000", window_seconds: 86400, on_breach: "pause_risk", on_valuation_unavailable: "deny",
      stablecoins: [USDG], exit_addresses: [COMPANY], max_exit_slippage_bps: 300, max_closed_market_price_age_seconds: 259200, reset_epoch: state.reset_epoch ?? 0,
    },
  };
  const s = await call("PUT", `/policies/${state.policy_id}`, { cookie, body: { document: doc } });
  const a = await call("POST", `/policies/${state.policy_id}/activate`, { cookie, body: { confirm: true, draft_hash: s.body.draft_hash } });
  console.log(`${utc()}  loss limit $0.005 over 24 h: v${a.body.activated_version ?? a.body.active_version} ${a.body.state ?? JSON.stringify(a.body.error)}`);
} else if (stage === "buy") {
  const wei = BigInt(arg);
  const q = await quote(WETH, USDG, wei);
  if (!needSend(`swap ${formatEther(wei)} ETH -> about ${Number(q) / 1e6} USDG through the Safe`)) process.exit(0);
  await execute(ROUTER, wei, swapData(WETH, USDG, wei, (q * 97n) / 100n));
} else if (stage === "sell") {
  const amount = BigInt(arg);
  const q = await quote(USDG, WETH, amount);
  if (!needSend(`approve ${Number(amount) / 1e6} USDG to the router, then swap it -> about ${formatEther(q)} WETH (two operations)`)) process.exit(0);
  await execute(USDG, 0n, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER, amount] }), 120000);
  await execute(ROUTER, 0n, swapData(USDG, WETH, amount, (q * 97n) / 100n));
} else if (stage === "try") {
  const amount = BigInt(arg);
  const q = await quote(USDG, WETH, amount);
  const nonce = () => pub.readContract({ address: ENTRY_POINT, abi: parseAbi(["function getNonce(address,uint192) view returns (uint256)"]), functionName: "getNonce", args: [state.safe, 0n] });
  const before = await nonce();
  const r = await call("POST", "/operations", { key: state.api_key, body: { request_id: `loss-try-${Date.now()}`, chain_id: 4663, to: ROUTER, value_wei: "0", data: swapData(USDG, WETH, amount, (q * 97n) / 100n), asset_intent: { spend: [{ token: USDG, amount: amount.toString() }], receive: [{ token: WETH, amount: q.toString() }] }, gas_limit: 300000, deadline: Math.floor(Date.now() / 1000) + 300 } });
  const after = await nonce();
  if (r.body.receipt) writeFileSync("receipt-loss.json", JSON.stringify(r.body.receipt, null, 2));
  Object.assign(state, { denied: { operation_id: r.body.operation_id, reason_code: r.body.reason_code } });
  save();
  console.log(`${utc()}  decision ${r.body.operation_id} ${r.body.decision} ${r.body.reason_code ?? ""}: ${r.body.message}\n  smart account nonce ${before} -> ${after}: ${before === after ? "nothing reached the chain" : "CHANGED"}${r.body.receipt ? "\n  signed receipt saved to receipt-loss.json" : ""}`);
} else if (stage === "exit") {
  const amount = BigInt(arg);
  if (!needSend(`send ${Number(amount) / 1e6} USDG from the Safe back to the company wallet`)) process.exit(0);
  await execute(USDG, 0n, encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [COMPANY, amount] }), 120000);
} else if (stage === "reset") {
  const cookie = await signIn();
  const r = await call("POST", `/agents/${state.agent_id}/loss-limit/reset`, { cookie, body: { confirm: true } });
  if (r.body.reset_epoch !== undefined) (state.reset_epoch = r.body.reset_epoch), save();
  console.log(`${utc()}  reset: ${r.body.state ?? JSON.stringify(r.body.error)} effective ${r.body.effective_at ?? "now"}`);
} else if (stage === "status") {
  const cookie = await signIn();
  const s = await call("GET", `/agents/${state.agent_id}/loss-limit`, { cookie });
  console.log(JSON.stringify(s.body, null, 2));
  if (state.safe) console.log(JSON.stringify(await readAccount(pub, state.safe, REGISTRY), (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
} else if (stage === "sync") {
  const r = await call("POST", "/public/peaa/sync");
  for (const x of r.body.results ?? []) console.log(`${utc()}  ${x.account}: ${x.sent.map((s) => `${s.kind} ${EXPLORER}/tx/${s.tx}`).join(" · ") || "nothing to send"}${x.skipped ? ` (${x.skipped})` : ""}${x.error ? " ERROR" : ""}`);
} else {
  console.log("stages: keys | org | safe | fund | policy | declare | limit | buy <wei> | sell <micros> | try <micros> | exit <micros> | reset | status | sync");
}
