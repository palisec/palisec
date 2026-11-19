#!/usr/bin/env node
/**
 * Phase 5 billing end to end on an anvil fork of Robinhood Chain mainnet (real USDG, real Chainlink
 * ETH/USD, real $PALISEC and its Pons curve). Two steps, because the server reads the contract address
 * from its environment:
 *
 *   anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663 --port 8546
 *   RPC_URL=http://127.0.0.1:8546 node scripts/e2e-billing.mjs setup > <state file outside the repo>
 *     deploys PalisecCredits, a TWAP oracle on the real curve ($1k depth floor for the fork) and fills it
 *   start the server with RH_MAINNET_RPC_URL=<anvil>, PALISEC_CREDITS_ADDRESS and PALISEC_CREDITS_DEPLOY_BLOCK
 *   from the state file, BILLING_FREE_DECISIONS=5, BILLING_CONFIRMATIONS=2, BILLING_PRO_CHECK_SECONDS=0, then
 *   BASE_URL=… RPC_URL=… STATE_FILE=… node scripts/e2e-billing.mjs test
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, parseAbiItem, parseUnits } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8546";
const BASE = process.env.BASE_URL ?? "http://localhost:3002";
const ORIGIN = new URL(BASE).origin;
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const PALISEC = "0x1B4d04c8A67bf98BdF791EF928482bcB225d71AB";
const ETH_USD = "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9";
const CURVE = "0x9f7383a2fcb30124A203D359e7a403F750a56501";
const PAL_HOLDER = "0xfD178447239ab1a9219364A44Eb8Bb8BDb77Be6B";
const art = (file, name) => JSON.parse(readFileSync(new URL(`../../../contracts/out/${file}/${name}.json`, import.meta.url), "utf8"));

const pub = createPublicClient({ transport: http(RPC) });
const rpc = (method, params = []) => pub.request({ method, params });
const [admin, buyer] = await rpc("eth_accounts");
const wallet = (account) => createWalletClient({ account, transport: http(RPC), chain: null });
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)", "function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)"]);

async function deploy(account, artifact, args) {
  const hash = await wallet(account).deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  return { address: r.contractAddress, block: r.blockNumber };
}
async function send(account, to, abi, functionName, args, value) {
  const hash = await wallet(account).writeContract({ address: to, abi, functionName, args, value });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted`);
  return r;
}
const mine = async (n = 3) => { for (let i = 0; i < n; i++) await rpc("evm_mine"); };

if (process.argv[2] === "setup") {
  const C = art("PalisecCredits.sol", "PalisecCredits");
  const treasury = privateKeyToAccount(generatePrivateKey()).address;
  const credits = await deploy(admin, C, [USDG, PALISEC, ETH_USD, { admin, treasury, priceUsdE6PerThousand: 5_000_000n, palisecDiscountBps: 2000, maxPalisecUsdE6PerPurchase: 10_000_000n, maxPalisecUsdE6PerAccountPerDay: 25_000_000n, maxUsdE6PerPurchase: 1_000_000_000n, maxPriceAge: 90_000, sequencerGracePeriod: 3600, sequencerUptimeFeed: "0x0000000000000000000000000000000000000000" }]);
  const source = await deploy(admin, art("PoolSources.sol", "PonsCurveSource"), [CURVE]);
  const oracle = await deploy(admin, art("PalisecTwapOracle.sol", "PalisecTwapOracle"), [source.address, ETH_USD, 1800, 60, 600, 1000, 1_000_000_000n, 90_000]);
  const O = art("PalisecTwapOracle.sol", "PalisecTwapOracle").abi;
  for (let i = 0; i < 9; i++) {
    await send(admin, oracle.address, O, "poke", []);
    await rpc("evm_increaseTime", [300]);
    await mine(1);
  }
  await send(admin, oracle.address, O, "poke", []);
  await send(admin, credits.address, C.abi, "setPalisecOracle", [oracle.address]);
  await send(admin, credits.address, C.abi, "setPalisecPath", [true]);
  console.log(JSON.stringify({ credits: credits.address, deployBlock: String(credits.block), oracle: oracle.address, treasury }));
  process.exit(0);
}

// ---------------------------------------------------------------- test
const S = JSON.parse(readFileSync(process.env.STATE_FILE, "utf8"));
const C = art("PalisecCredits.sol", "PalisecCredits").abi;
let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || detail === undefined ? "" : `  -> ${JSON.stringify(detail, (_, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 400)}`}`);
}
async function call(method, path, { cookie, key, body, headers = {} } = {}) {
  const h = { origin: ORIGIN, ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  if (cookie) h.cookie = cookie;
  if (key) h.authorization = `Bearer ${key}`;
  const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
}
async function signIn(account) {
  const c = await call("POST", "/auth/challenges", { body: { address: account.address, chain_id: 4663 } });
  const res = await fetch(`${BASE}/api/v1/auth/verify`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ nonce: c.body.nonce, signature: await account.signMessage({ message: c.body.message }) }) });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}
const rand = () => privateKeyToAccount(generatePrivateKey()).address;
const now = () => Math.floor(Date.now() / 1000);

const owner = privateKeyToAccount(generatePrivateKey());
const cookie = await signIn(owner);
check("owner signs in", cookie.includes("="));
const ACCOUNT = rand();
const TARGET = rand();

async function setupAgent(chain) {
  const acct = chain === 4663 ? ACCOUNT : rand();
  let r = await call("POST", "/policies", { cookie, body: { name: `p${chain}`, policy_key: `billing_${chain}_${Date.now()}`, chain_id: chain, account: acct } });
  const pid = r.body.id;
  const draft = { ...r.body.draft, limits: { ...r.body.draft.limits, max_transaction_value_wei: "1000000000000000000", hourly_budget_usd_micros: "100000000000", max_pending_operations: 1000, max_price_age_seconds: 600 }, cooldowns: { identical_calldata_seconds: 0, identical_intent_seconds: 0 }, contracts: { default: "deny", allowlist: [{ address: TARGET, selectors: [], require_verified_code: false }], denylist: [] }, human_approval: { usd_threshold_micros: "100000000000", require_for_unknown_methods: true } };
  r = await call("PUT", `/policies/${pid}`, { cookie, body: { document: draft } });
  await call("POST", `/policies/${pid}/activate`, { cookie, body: { confirm: true, draft_hash: r.body.draft_hash } });
  r = await call("POST", "/agents", { cookie, body: { name: `agent ${chain}`, chain_id: chain, account: acct, policy_id: pid } });
  const agentId = r.body.id;
  r = await call("POST", `/agents/${agentId}/credentials`, { cookie, body: { label: "e2e" } });
  return { key: r.body.secret, agentId };
}
const live = await setupAgent(4663);
const test = await setupAgent(46630);
check("mainnet agent has a ps_live_ key", /^ps_live_/.test(live.key ?? ""), live);
const intent = (chain, over = {}) => ({ request_id: `bill_${Math.random().toString(36).slice(2)}`, chain_id: chain, to: TARGET, value_wei: "0", data: "0x", gas_limit: 21000, deadline: now() + 300, ...over });
const opsCount = async () => (await call("GET", `/operations?agent_id=${live.agentId}&limit=200`, { cookie })).body.operations?.length ?? -1;
const billing = async () => (await call("GET", "/billing", { cookie })).body;

// ---------------------------------------------------------------- T1 free allowance, warnings, T10 refusal
const usage = [];
for (let i = 0; i < 5; i++) {
  const r = await call("POST", "/operations", { key: live.key, body: intent(4663) });
  usage.push([r.status, r.headers.get("x-palisec-usage"), r.headers.get("x-palisec-usage-warning")]);
}
check("T1: the 5 free mainnet decisions are recorded", usage.every((u) => u[0] === 201), usage);
check("T1: usage header counts them (free=5/5 on the 5th)", usage[4][1]?.startsWith("free=5/5"), usage[4]);
check("T1: warning at 80% (4 of 5)", /80%/.test(usage[3][2] ?? ""), usage[3]);
const before = await opsCount();
let r = await call("POST", "/operations", { key: live.key, body: intent(4663) });
check("T1/T10: past the allowance with no credits: 402 PS_CREDIT_001, never allowed", r.status === 402 && r.body.error?.code === "PS_CREDIT_001" && r.body.decision === undefined, r.body);
check("T10: the refused request is not recorded as an operation", (await opsCount()) === before, { before, after: await opsCount() });
r = await call("POST", "/authorizations/evaluate", { key: live.key, body: intent(4663) });
check("dry runs are not metered (200 after the allowance is used)", r.status === 200 && r.body.dry_run === true, r.body);
r = await call("POST", "/operations", { key: test.key, body: intent(46630) });
check("testnet decisions are not metered", r.status === 201 && !r.headers.get("x-palisec-usage"), r.body);
let b = await billing();
check("billing summary: 5 of 5 used, 0 credits, a purchase account", b.used === 5 && b.free === 5 && b.credits === 0 && /^0x[0-9a-f]{64}$/.test(b.purchase_account ?? ""), b);
const ACC = b.purchase_account;

// ---------------------------------------------------------------- T3 USDG purchase, T7 credited once
const transfers = await pub.getLogs({ address: USDG, event: parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 value)"), fromBlock: (await pub.getBlockNumber()) - 2000n });
let whale = null;
let best = 0n;
for (const a of [...new Set(transfers.map((t) => t.args.to))].slice(0, 40)) {
  const bal = await pub.readContract({ address: USDG, abi: ERC20, functionName: "balanceOf", args: [a] });
  if (bal > best) { best = bal; whale = a; }
}
await rpc("anvil_impersonateAccount", [whale]);
await rpc("anvil_setBalance", [whale, "0x56BC75E2D63100000"]);
await send(whale, USDG, ERC20, "transfer", [buyer, parseUnits("100", 6)]);
await send(buyer, USDG, ERC20, "approve", [S.credits, 2n ** 256n - 1n]);
const treasuryUsdg0 = await pub.readContract({ address: USDG, abi: ERC20, functionName: "balanceOf", args: [S.treasury] });
const usdgTx = await send(buyer, S.credits, C, "buyWithUsdg", [ACC, 10n]);
check("T3: USDG paid straight to the treasury ($0.05 for 10 credits)", (await pub.readContract({ address: USDG, abi: ERC20, functionName: "balanceOf", args: [S.treasury] })) - treasuryUsdg0 === 50_000n);
b = await billing();
check("T3: not credited before the confirmations", b.credits === 0, b.credits);
await mine(3);
b = await billing();
check("T3: credited after 2 confirmations: 10 credits", b.credits === 10, b);
b = await billing();
check("T7: reading the same event again credits nothing more", b.credits === 10, b.credits);
check("T3: purchase history has the USDG purchase with its tx", b.history?.some((h) => h.asset === "USDG" && h.tx_hash === usdgTx.transactionHash.toLowerCase() && h.credits === "10"), b.history);

// ---------------------------------------------------------------- T4 30 concurrent requests, 10 credits
const results = await Promise.all(Array.from({ length: 30 }, () => call("POST", "/operations", { key: live.key, body: intent(4663) })));
const ok = results.filter((x) => x.status === 201).length;
const refused = results.filter((x) => x.status === 402).length;
check("T4: 30 concurrent requests with 10 credits: exactly 10 decisions, 20 refused", ok === 10 && refused === 20, { ok, refused, other: results.filter((x) => ![201, 402].includes(x.status)).map((x) => x.status) });
b = await billing();
check("T4: no credit spent twice: balance 0", b.credits === 0, b.credits);

// ---------------------------------------------------------------- idempotent replay is not metered
const replayBody = intent(4663);
await send(buyer, S.credits, C, "buyWithUsdg", [ACC, 2n]);
await mine(3);
await billing();
const first = await call("POST", "/operations", { key: live.key, body: replayBody, headers: { "idempotency-key": "bill-replay-1" } });
const again = await call("POST", "/operations", { key: live.key, body: replayBody, headers: { "idempotency-key": "bill-replay-1" } });
b = await billing();
check("an idempotent replay returns the original and spends nothing", first.status === 201 && again.status === 200 && b.credits === 1, { first: first.status, again: again.status, credits: b.credits });

// ---------------------------------------------------------------- T3 ETH purchase
const quote = await pub.readContract({ address: S.credits, abi: C, functionName: "quoteWei", args: [5n] });
const treasuryEth0 = await pub.getBalance({ address: S.treasury });
await send(buyer, S.credits, C, "buyWithEth", [ACC, 5n], quote + 10n ** 15n);
check("T3: ETH forwarded to the treasury at the Chainlink price, rest refunded", (await pub.getBalance({ address: S.treasury })) - treasuryEth0 === quote && (await pub.getBalance({ address: S.credits })) === 0n);
await mine(3);
b = await billing();
check("T3: ETH purchase credited (1 + 5)", b.credits === 6, b.credits);

// ---------------------------------------------------------------- T2 (fork) $PALISEC purchase burns in the same tx, T9 burn counter
await rpc("anvil_impersonateAccount", [PAL_HOLDER]);
await rpc("anvil_setBalance", [PAL_HOLDER, "0x56BC75E2D63100000"]);
await send(PAL_HOLDER, PALISEC, ERC20, "transfer", [buyer, parseUnits("2000000", 18)]);
await send(buyer, PALISEC, ERC20, "approve", [S.credits, 2n ** 256n - 1n]);
const supply0 = await pub.readContract({ address: PALISEC, abi: ERC20, functionName: "totalSupply" });
const palTx = await send(buyer, S.credits, C, "buyWithPalisec", [ACC, 1000n, 2n ** 256n - 1n]);
const burned = supply0 - (await pub.readContract({ address: PALISEC, abi: ERC20, functionName: "totalSupply" }));
const transferLogs = palTx.logs.filter((l) => l.address.toLowerCase() === PALISEC.toLowerCase());
check("T2: $PALISEC burned in the purchase transaction (Transfer to 0x0 in the same tx)", burned > 0n && transferLogs.some((l) => l.topics[2] === `0x${"0".repeat(64)}`), { burned, logs: transferLogs.length });
await mine(3);
b = await billing();
check("T2: credited once with the 20% discount ($4 of tokens for 1,000 credits)", b.credits === 1006 && b.history?.some((h) => h.asset === "PALISEC" && h.usd_micros === "4000000" && h.burned === burned.toString()), b.history?.[0]);
const burns = await (await fetch(`${BASE}/api/v1/token/burns`)).json();
check("T9: burn counter equals the chain (total = sum of burns, one row with its tx)", burns.total_burned === burned.toString() && burns.purchases === 1 && burns.rows?.[0]?.tx_hash === palTx.transactionHash, burns);

// ---------------------------------------------------------------- T5 caps refused by the contract
let capRefused = false;
try {
  await send(buyer, S.credits, C, "buyWithPalisec", [ACC, 3000n, 2n ** 256n - 1n]); // $12 after discount > $10
} catch {
  capRefused = true;
}
check("T5: a purchase above the per-purchase cap is refused by the contract", capRefused);
let dayRefused = false;
await send(buyer, S.credits, C, "buyWithPalisec", [ACC, 2500n, 2n ** 256n - 1n]); // $10 (total $14)
await send(buyer, S.credits, C, "buyWithPalisec", [ACC, 2500n, 2n ** 256n - 1n]); // $10 (total $24)
try {
  await send(buyer, S.credits, C, "buyWithPalisec", [ACC, 500n, 2n ** 256n - 1n]); // $2 -> $26 > $25
} catch {
  dayRefused = true;
}
check("T5: the daily cap per account is refused by the contract", dayRefused);

// ---------------------------------------------------------------- T8 Pro by holdings
b = await billing();
check("T8: not Pro without holdings (normal limits)", b.pro?.active === false && b.limits?.agents === 10, b.pro);
for (let i = 0; i < 9; i++) await call("POST", "/agents", { cookie, body: { name: `extra ${i}`, chain_id: 4663, account: ACCOUNT, policy_id: null } });
r = await call("POST", "/agents", { cookie, body: { name: "one too many", chain_id: 4663, account: ACCOUNT } });
check("T8: normal plan: the 11th agent is refused (PS_PLAN_001)", r.status === 403 && r.body.error?.code === "PS_PLAN_001", r.body);
await send(PAL_HOLDER, PALISEC, ERC20, "transfer", [owner.address, parseUnits("5000000", 18)]);
b = await billing();
check("T8: owner wallet holds 5,000,000 → Pro limits", b.pro?.active === true && b.limits?.agents === 50, b.pro);
r = await call("POST", "/agents", { cookie, body: { name: "pro agent", chain_id: 4663, account: ACCOUNT } });
check("T8: Pro: the 11th agent is allowed", r.status === 201, r.body);
await rpc("anvil_impersonateAccount", [owner.address]);
await rpc("anvil_setBalance", [owner.address, "0x56BC75E2D63100000"]);
await send(owner.address, PALISEC, ERC20, "transfer", [PAL_HOLDER, 1n]);
b = await billing();
check("T8: below 5,000,000 → back to normal limits, nothing deleted", b.pro?.active === false && b.limits?.agents === 10, b.pro);
r = await call("POST", "/agents", { cookie, body: { name: "after downgrade", chain_id: 4663, account: ACCOUNT } });
const agents = await call("GET", "/agents", { cookie });
check("T8: after the downgrade new agents are refused, existing ones stay", r.status === 403 && agents.body.agents?.length >= 12, { status: r.status, agents: agents.body.agents?.length });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
