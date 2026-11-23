#!/usr/bin/env node
/**
 * Phase 6 on real testnet with a PALISEC smart account: a Safe (threshold 2; owners: the agent's key,
 * PALISEC's testnet co-signer, a recovery owner) built exactly as the console builds one, then buys of a
 * normal token, a honeypot and a 20%-sell-tax token decided by the real API (POST /v1/operations) with
 * asset safety on. Uses the AssetTestKit already deployed by e2e-phase6.mjs on testnet.
 *
 *   BASE_URL=https://palisec.tech TESTNET_KEY_FILE=<test-only funded key> USD=… NORMAL=… HONEY=… TAX=… ROUTER=… \
 *     node apps/web/scripts/e2e-phase6-safe.mjs
 */
import { readFileSync } from "node:fs";
import { concat, createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, maxUint256, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.BASE_URL ?? "https://palisec.tech";
const RPC = "https://rpc.testnet.chain.robinhood.com";
const CHAIN = 46630;
const EXPLORER = "https://explorer.testnet.chain.robinhood.com";
const { USD, NORMAL, HONEY, TAX, ROUTER } = process.env;
const FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const MODULE = "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226";
const MODULE_SETUP = "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47";
const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const ZERO = "0x0000000000000000000000000000000000000000";
const E18 = 10n ** 18n;

let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  -> ${JSON.stringify(detail).slice(0, 400)}`}`);
};
async function call(method, path, { cookie, key, body } = {}) {
  const h = { origin: BASE };
  if (body !== undefined) h["content-type"] = "application/json";
  if (cookie) h.cookie = cookie;
  if (key) h.authorization = `Bearer ${key}`;
  const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
}

const recovery = privateKeyToAccount(JSON.parse(readFileSync(process.env.TESTNET_KEY_FILE, "utf8")).key);
const agentKey = privateKeyToAccount(generatePrivateKey());
const chain = { id: CHAIN, name: "Robinhood Chain Testnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account: recovery, chain, transport: http(RPC) });
const wait = async (hash, what) => {
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`      ${what}: ${EXPLORER}/tx/${hash}`);
  if (r.status !== "success") throw new Error(`${what} failed`);
  return r;
};

// Sign in (the recovery owner is the organization's owner) and read PALISEC's testnet co-signer.
const c = await call("POST", "/auth/challenges", { body: { address: recovery.address, chain_id: CHAIN } });
const v = await call("POST", "/auth/verify", { body: { nonce: c.body.nonce, signature: await recovery.signMessage({ message: c.body.message }) } });
const cookie = (v.headers.get("set-cookie") ?? "").split(";")[0];
const cfg = await call("GET", `/smart-accounts?chain_id=${CHAIN}`, { cookie });
const palisecSigner = cfg.body.palisec_signer;
check("production reports PALISEC's testnet co-signer", /^0x[0-9a-fA-F]{40}$/.test(palisecSigner ?? ""), cfg.body);

// The Safe, as the console creates it: threshold 2, the 4337 module enabled.
const initializer = encodeFunctionData({
  abi: parseAbi(["function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)"]),
  functionName: "setup",
  args: [[agentKey.address, palisecSigner, recovery.address], 2n, MODULE_SETUP, encodeFunctionData({ abi: parseAbi(["function enableModules(address[] modules)"]), functionName: "enableModules", args: [[MODULE]] }), MODULE, ZERO, 0n, ZERO],
});
const FACTORY_ABI = parseAbi(["function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)"]);
const salt = BigInt(Date.now());
const { result: safe } = await pub.simulateContract({ account: recovery, address: FACTORY, abi: FACTORY_ABI, functionName: "createProxyWithNonce", args: [SINGLETON, initializer, salt] });
await wait(await wallet.writeContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "createProxyWithNonce", args: [SINGLETON, initializer, salt] }), `Safe ${safe} created`);
const report = await call("GET", `/smart-accounts/${safe}?chain_id=${CHAIN}`, { cookie });
check("production verifies it as a PALISEC smart account (threshold 2, module, co-signer)", report.body.enforced === true, report.body);

// Setup the Safe's own standing approval for the router: a Safe transaction signed by the agent key and the recovery owner.
await wait(await wallet.writeContract({ address: USD, abi: erc20Abi, functionName: "transfer", args: [safe, 1000n * E18] }), "1000 test USD to the Safe");
const SAFE_TX = parseAbi([
  "function nonce() view returns (uint256)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
]);
const approveData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROUTER, maxUint256] });
const safeNonce = await pub.readContract({ address: safe, abi: SAFE_TX, functionName: "nonce" });
const typed = {
  domain: { chainId: CHAIN, verifyingContract: safe },
  types: { SafeTx: [
    { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
  ] },
  primaryType: "SafeTx",
  message: { to: USD, value: 0n, data: approveData, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: safeNonce },
};
const signers = [agentKey, recovery].sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1));
const sigs = concat(await Promise.all(signers.map((s) => s.signTypedData(typed))));
await wait(await wallet.writeContract({ address: safe, abi: SAFE_TX, functionName: "execTransaction", args: [USD, 0n, approveData, 0, 0n, 0n, 0n, ZERO, ZERO, sigs] }), "Safe approves the test router (setup)");

// Policy with asset safety (the defaults new policies get), agent bound to the Safe.
const p = await call("POST", "/policies", { cookie, body: { name: "Phase 6 Safe test", policy_key: `p6_safe_${Date.now()}`, chain_id: CHAIN, account: safe } });
const doc = {
  ...p.body.draft,
  limits: { ...p.body.draft.limits, max_price_age_seconds: 600, max_gas_cost_wei: "1000000000000000000" },
  cooldowns: { identical_calldata_seconds: 0, identical_intent_seconds: 0 },
  contracts: { default: "deny", allowlist: [{ address: ROUTER, selectors: ["0x38ed1739"], require_verified_code: true }], denylist: [] },
  human_approval: { usd_threshold_micros: "999999999999", require_for_unknown_methods: false },
};
const s = await call("PUT", `/policies/${p.body.id}`, { cookie, body: { document: doc } });
const act = await call("POST", `/policies/${p.body.id}/activate`, { cookie, body: { confirm: true, draft_hash: s.body.draft_hash } });
check("policy active with asset safety on", act.body.state === "active" && act.body.active_document?.asset_safety?.enabled === true, act.body);
const ag = await call("POST", "/agents", { cookie, body: { name: "Phase 6 Safe agent", chain_id: CHAIN, account: safe, policy_id: p.body.id } });
const key = (await call("POST", `/agents/${ag.body.id}/credentials`, { cookie, body: {} })).body.secret;

const entryNonce = () => pub.readContract({ address: ENTRY_POINT, abi: parseAbi(["function getNonce(address,uint192) view returns (uint256)"]), functionName: "getNonce", args: [safe, 0n] });
const before = { safe: await pub.readContract({ address: safe, abi: SAFE_TX, functionName: "nonce" }), entry: await entryNonce() };
const swap = (token) =>
  encodeFunctionData({ abi: parseAbi(["function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])"]), functionName: "swapExactTokensForTokens", args: [E18, 0n, [USD, token], safe, BigInt(Math.floor(Date.now() / 1000) + 600)] });
const decide = (token, label) =>
  call("POST", "/operations", {
    key,
    body: { request_id: `p6safe-${label}-${Date.now()}`, chain_id: CHAIN, to: ROUTER, value_wei: "0", data: swap(token), gas_limit: 300000, deadline: Math.floor(Date.now() / 1000) + 300, asset_intent: { spend: [{ token: USD, amount: E18.toString() }] } },
  });
const show = (label, r) => console.log(`      ${label}: decision ${r.body.decision} ${r.body.reason_code ?? ""} | decision ID ${r.body.operation_id} | request ${r.body.request_id}\n        ${r.body.checks?.find((x) => x.id === "asset")?.detail ?? r.body.message}`);

let r = await decide(NORMAL, "normal");
show("normal token", r);
check("normal token buy through the Safe is allowed, with the asset numbers", r.body.decision === "ALLOW" && /sell leg ok/.test(r.body.checks?.find((x) => x.id === "asset")?.detail ?? ""), r.body);
// Release the unused authorization (it is never executed).
await call("POST", `/operations/${r.body.operation_id}/cancel`, { cookie, body: { confirm: true } });
r = await decide(HONEY, "honeypot");
show("honeypot", r);
check("honeypot through the Safe -> DENY PS_ASSET_001", r.body.decision === "DENY" && r.body.reason_code === "PS_ASSET_001", r.body);
r = await decide(TAX, "tax20");
show("20% tax token", r);
check("20% sell-tax token through the Safe -> DENY PS_ASSET_002", r.body.decision === "DENY" && r.body.reason_code === "PS_ASSET_002", r.body);
const after = { safe: await pub.readContract({ address: safe, abi: SAFE_TX, functionName: "nonce" }), entry: await entryNonce() };
check(`nothing reached the chain from the Safe (Safe nonce ${before.safe}->${after.safe}, EntryPoint nonce ${before.entry}->${after.entry})`, after.safe === before.safe && after.entry === before.entry);
console.log(`\nSafe ${EXPLORER}/address/${safe}\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
