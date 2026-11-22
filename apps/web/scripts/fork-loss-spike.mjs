#!/usr/bin/env node
/**
 * Phase 9 price-manipulation test on a mainnet fork (no real money). A test server reads the chain from
 * an Anvil fork of Robinhood Chain mainnet. A large swap then moves the USDG/ETH Uniswap pool's price in
 * one block, and the test shows:
 *  1. the account's value (Chainlink prices) and the decision for an account that is not trading are unchanged:
 *     a spike cannot trigger a breach;
 *  2. a breach that already happened stays measured and paused after the spike: a spike cannot hide it;
 *  3. a trade into the distorted pool returns fewer tokens, which counts as a loss and is denied.
 *
 *   anvil --fork-url https://rpc.mainnet.chain.robinhood.com --port 8545 --chain-id 4663
 *   (test server started with RH_MAINNET_RPC_URL=http://127.0.0.1:8545)
 *   BASE_URL=http://localhost:3002 FORK_RPC=http://127.0.0.1:8545 node apps/web/scripts/fork-loss-spike.mjs
 */
import { createPublicClient, encodeFunctionData, http, parseAbi, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.BASE_URL ?? "http://localhost:3002";
const FORK = process.env.FORK_RPC ?? "http://127.0.0.1:8545";
const SAFE = "0x375BdF5DA6b7440889e50f13C894A3C4AC988329";
const EXIT = "0x989EfcD8Ad76E695CFD5ba915b1b12118471c430";
const TARGET = "0x000000000000000000000000000000000000dEaD";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2";
const WHALE = "0x00000000000000000000000000000000000b1a7e";
const ROUTER_ABI = parseAbi(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)"]);
let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  -> ${JSON.stringify(detail).slice(0, 500)}`}`);
};
const rpc = async (method, params) => {
  const r = await fetch(FORK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((x) => x.json());
  if (r.error) throw new Error(`${method}: ${r.error.message}`);
  return r.result;
};
const receipt = async (tx) => {
  for (let i = 0; i < 1200; i++) {
    const r = await rpc("eth_getTransactionReceipt", [tx]);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 500));
  }
  return null;
};
async function call(method, path, { cookie, key, body } = {}) {
  const h = { origin: BASE };
  if (body !== undefined) h["content-type"] = "application/json";
  if (cookie) h.cookie = cookie;
  if (key) h.authorization = `Bearer ${key}`;
  const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
}
const swapData = (recipient, amountIn) =>
  encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn: WETH, tokenOut: USDG, fee: 100, recipient, amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] });

const chainId = await createPublicClient({ transport: http(FORK) }).getChainId();
check("the test server's chain is the fork (chain 4663)", chainId === 4663, chainId);

const owner = privateKeyToAccount(generatePrivateKey());
const ch = await call("POST", "/auth/challenges", { body: { address: owner.address, chain_id: 4663 } });
const v = await call("POST", "/auth/verify", { body: { nonce: ch.body.nonce, signature: await owner.signMessage({ message: ch.body.message }) } });
const cookie = (v.headers.get("set-cookie") ?? "").split(";")[0];
const p = await call("POST", "/policies", { cookie, body: { name: "spike", policy_key: `loss_spike_${Date.now()}`, chain_id: 4663, account: SAFE } });
const doc = {
  ...p.body.draft,
  schema_version: "1.3",
  asset_safety: { ...p.body.draft.asset_safety, enabled: false },
  limits: { ...p.body.draft.limits, max_transaction_value_wei: "1000000000000000", max_price_age_seconds: 600, hourly_budget_usd_micros: "100000000" },
  cooldowns: { identical_calldata_seconds: 0, identical_intent_seconds: 0 },
  contracts: { default: "deny", allowlist: [{ address: TARGET, selectors: [], require_verified_code: false }, { address: ROUTER, selectors: ["0x04e45aaf"], require_verified_code: false }], denylist: [] },
  human_approval: { usd_threshold_micros: "999999999999", require_for_unknown_methods: false },
  loss_limit: {
    enabled: true, max_drawdown_bps: 0, max_loss_usd_micros: "50000", window_seconds: 86400, on_breach: "pause_risk", on_valuation_unavailable: "deny",
    stablecoins: [USDG], exit_addresses: [EXIT], max_exit_slippage_bps: 300, max_closed_market_price_age_seconds: 259200, reset_epoch: 0,
  },
};
const s = await call("PUT", `/policies/${p.body.id}`, { cookie, body: { document: doc } });
await call("POST", `/policies/${p.body.id}/activate`, { cookie, body: { confirm: true, draft_hash: s.body.draft_hash } });
const ag = await call("POST", "/agents", { cookie, body: { name: "Spike", chain_id: 4663, account: SAFE, policy_id: p.body.id } });
const key = (await call("POST", `/agents/${ag.body.id}/credentials`, { cookie, body: {} })).body.secret;
let n = 0;
const req = (to, value, data = "0x") => ({ request_id: `spike-${Date.now()}-${++n}`, chain_id: 4663, to, value_wei: value, data, gas_limit: 300000, deadline: Math.floor(Date.now() / 1000) + 120 });
const dry = (to, value, data) => call("POST", "/authorizations/evaluate", { key, body: req(to, value, data) });
const loss = (x) => x.body.checks?.find((c) => c.id === "loss")?.detail ?? x.body.message;
const status = () => call("GET", `/agents/${ag.body.id}/loss-limit`, { cookie }).then((x) => x.body);
const tradeIn = 100_000_000_000_000n; // 0.0001 ETH (about $0.17)
const QUOTE_ABI = parseAbi(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)"]);
const fork = createPublicClient({ transport: http(FORK, { timeout: 600_000 }) });
const quote = async () => BigInt((await fork.call({ account: SAFE, to: ROUTER, value: tradeIn, data: swapData(SAFE, tradeIn) })).data);
// The fork loads mainnet state lazily, so the first reads can exceed the server's timeouts (it then fails
// closed with PS_LOSS_003). Repeat until the fork has the state cached.
const settled = async (fn) => {
  let x;
  for (let i = 0; i < 8; i++) {
    x = await fn();
    if (x.body.reason_code !== "PS_LOSS_003") return x;
  }
  return x;
};

// Before the spike.
let r = await settled(() => dry(ROUTER, tradeIn.toString(), swapData(SAFE, tradeIn)));
const fair = await quote();
console.log(`      swap 0.0001 ETH -> USDG before the spike: ${r.body.decision} ${r.body.reason_code ?? ""} | ${loss(r)}`);
check("before the spike, a small swap at the fair pool price is allowed", r.body.decision === "ALLOW", r.body);
const before = await status();

// One block: a large ETH -> USDG swap crashes ETH's price in the pool.
await rpc("anvil_setBalance", [WHALE, "0x" + parseEther("1000000").toString(16)]);
await rpc("anvil_impersonateAccount", [WHALE]);
// Grow the swap until the pool's price for our trade has collapsed (concentrated liquidity is deep near the price).
let spiked = fair;
let rcpt = null;
for (const eth of ["1000", "4000", "16000", "64000"]) {
  const big = parseEther(eth);
  const tx = await rpc("eth_sendTransaction", [{ from: WHALE, to: ROUTER, value: "0x" + big.toString(16), data: swapData(WHALE, big), gas: "0x" + (30_000_000).toString(16) }]);
  rcpt = await receipt(tx);
  spiked = await quote();
  console.log(`      manipulation: ${eth} ETH sold into the pool; 0.0001 ETH now buys ${Number(spiked) / 1e6} USDG (was ${Number(fair) / 1e6})`);
  if (spiked * 2n < fair) break;
}
check("the manipulation moved the pool's price by more than half, in one block", rcpt?.status === "0x1" && spiked * 2n < fair, { fair: String(fair), spiked: String(spiked) });

// 1) Not trading: no false breach, value unchanged (Chainlink, not the pool).
r = await settled(() => dry(TARGET, "10000000000"));
console.log(`      tiny payment after the spike: ${r.body.decision} ${r.body.reason_code ?? ""} | ${loss(r)}`);
check("after the spike, an account that is not trading into the pool is not breached", r.body.decision === "ALLOW", r.body);
const after = await status();
const drift = Math.abs(Number(after.value_usd_micros) - Number(before.value_usd_micros));
console.log(`      account value before $${(Number(before.value_usd_micros) / 1e6).toFixed(4)}, after $${(Number(after.value_usd_micros) / 1e6).toFixed(4)}`);
check("the account's value does not follow the pool's spiked price", drift <= 1000, { before: before.value_usd_micros, after: after.value_usd_micros });

// 3) Trading into the distorted pool: fewer tokens back = a loss, denied.
r = await settled(() => dry(ROUTER, tradeIn.toString(), swapData(SAFE, tradeIn)));
console.log(`      the same swap into the distorted pool: ${r.body.decision} ${r.body.reason_code ?? ""} | ${loss(r)}`);
check("a trade into the distorted pool counts its real result as a loss -> DENY PS_LOSS_002", r.body.decision === "DENY" && r.body.reason_code === "PS_LOSS_002", r.body);

// 2) A breach cannot be hidden: record it, spike again, still paused with the loss measured.
r = await settled(() => call("POST", "/operations", { key, body: req(ROUTER, tradeIn.toString(), swapData(SAFE, tradeIn)) }));
check("recorded: the account is paused", r.body.reason_code === "PS_LOSS_002", r.body);
const tx2 = await rpc("eth_sendTransaction", [{ from: WHALE, to: ROUTER, value: "0x" + parseEther("5000").toString(16), data: swapData(WHALE, parseEther("5000")), gas: "0x" + (3_000_000).toString(16) }]);
await receipt(tx2);
r = await settled(() => dry(TARGET, "10000000000"));
check("after a second spike the account is still paused (a spike cannot hide a breach)", r.body.reason_code === "PS_LOSS_002" && /adds risk/.test(r.body.message), r.body);
const end = await status();
check("status after the second spike: paused, value still at Chainlink prices", end.paused === "PS_LOSS_002" && Math.abs(Number(end.value_usd_micros) - Number(before.value_usd_micros)) <= 1000, end);

await rpc("anvil_stopImpersonatingAccount", [WHALE]);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
