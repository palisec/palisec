#!/usr/bin/env node
/**
 * Smart-account execution end to end: a Safe (threshold 2: agent key, PALISEC co-signer, recovery owner)
 * on a fork of Robinhood Chain Testnet or mainnet, an allowed operation prepared, signed by the agent,
 * co-signed and submitted by PALISEC, executed on chain, and every refusal path.
 *
 *   RPC_URL=http://127.0.0.1:8545 BASE_URL=http://localhost:3000 [CHAIN_ID=4663] node apps/web/scripts/e2e-smart-account.mjs
 *
 * Testnet (default): the server runs with RH_TESTNET_RPC_URL=$RPC_URL (an anvil fork) and PALISEC_SIGNER_KEY.
 * Mainnet (CHAIN_ID=4663): PALISEC_MAINNET=enabled, RH_MAINNET_RPC_URL=$RPC_URL (an anvil fork of mainnet)
 * and PALISEC_MAINNET_SIGNER_KEY, a different key. Both need PALISEC_TEST_BUNDLER_URL (scripts/test-bundler.mjs).
 */
import { createPublicClient, createWalletClient, encodeFunctionData, hashTypedData, http, parseAbi, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPalisec } from "../../../packages/sdk/dist/index.js";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN = Number(process.env.CHAIN_ID ?? 46630);
const KEY_PREFIX = CHAIN === 4663 ? "ps_live_" : "ps_test_";
const FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const MODULE = "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226";
const MODULE_SETUP = "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47";
const ZERO = "0x0000000000000000000000000000000000000000";

let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  -> ${JSON.stringify(detail, (_, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 400)}`}`);
};

async function call(method, path, { cookie, body, key } = {}) {
  const h = { origin: BASE };
  if (body !== undefined) h["content-type"] = "application/json";
  if (cookie) h.cookie = cookie;
  if (key) h.authorization = `Bearer ${key}`;
  const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function signIn(account) {
  const c = await call("POST", "/auth/challenges", { body: { address: account.address, chain_id: 46630 } });
  const res = await fetch(`${BASE}/api/v1/auth/verify`, {
    method: "POST",
    headers: { origin: BASE, "content-type": "application/json" },
    body: JSON.stringify({ nonce: c.body.nonce, signature: await account.signMessage({ message: c.body.message }) }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

// ---- chain: a Safe exactly as the console creates it ---------------------------------------------
const pub = createPublicClient({ transport: http(RPC) });
const [funder] = await pub.request({ method: "eth_accounts" });
const chainWallet = createWalletClient({ account: funder, transport: http(RPC) });
const owner = privateKeyToAccount(generatePrivateKey());
const agentKey = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const recipient = privateKeyToAccount(generatePrivateKey()).address;
const cookie = await signIn(owner);

const forkChain = await pub.getChainId();
check(`setup: the fork reports chain ${CHAIN}`, forkChain === CHAIN, forkChain);
const cfg = await call("GET", `/smart-accounts?chain_id=${CHAIN}`, { cookie });
check("config: co-signer and submission are available", cfg.status === 200 && /^0x[0-9a-fA-F]{40}$/.test(cfg.body.palisec_signer ?? "") && cfg.body.submission === "available", cfg.body);
const palisec = cfg.body.palisec_signer;

const SAFE_ABI = parseAbi(["function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)"]);
const FACTORY_ABI = parseAbi(["function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)"]);
const initializer = encodeFunctionData({
  abi: SAFE_ABI,
  functionName: "setup",
  args: [[agentKey.address, palisec, owner.address], 2n, MODULE_SETUP, encodeFunctionData({ abi: parseAbi(["function enableModules(address[] modules)"]), functionName: "enableModules", args: [[MODULE]] }), MODULE, ZERO, 0n, ZERO],
});
const salt = BigInt(Date.now());
const { result: safe } = await pub.simulateContract({ account: funder, address: FACTORY, abi: FACTORY_ABI, functionName: "createProxyWithNonce", args: [SINGLETON, initializer, salt] });
await pub.waitForTransactionReceipt({ hash: await chainWallet.writeContract({ chain: null, address: FACTORY, abi: FACTORY_ABI, functionName: "createProxyWithNonce", args: [SINGLETON, initializer, salt] }) });
await pub.request({ method: "anvil_setBalance", params: [safe, "0xde0b6b3a7640000"] });
check("chain: Safe created and funded on the fork", ((await pub.getCode({ address: safe })) ?? "0x").length > 2, safe);

// ---- control plane: policy and agent bound to the Safe --------------------------------------------
async function policyFor(account, label, allow) {
  const p = await call("POST", "/policies", { cookie, body: { name: `${label} policy`, policy_key: `${label}_${Date.now()}`, chain_id: CHAIN, account } });
  const draft = {
    ...p.body.draft,
    limits: { ...p.body.draft.limits, max_price_age_seconds: 120, max_pending_operations: 50, max_transaction_value_wei: parseEther("0.05").toString(), hourly_budget_usd_micros: "1000000000" },
    cooldowns: { identical_calldata_seconds: 0, identical_intent_seconds: 0 },
    contracts: { default: "deny", allowlist: [{ address: allow, selectors: ["0xa9059cbb"], require_verified_code: false }], denylist: [] },
    human_approval: { usd_threshold_micros: "50000000", require_for_unknown_methods: false },
  };
  const saved = await call("PUT", `/policies/${p.body.id}`, { cookie, body: { document: draft } });
  const act = await call("POST", `/policies/${p.body.id}/activate`, { cookie, body: { confirm: true, draft_hash: saved.body.draft_hash } });
  if (act.status >= 300) console.log("policy activation:", act.status, JSON.stringify(act.body).slice(0, 300));
  return p.body.id;
}
async function agentFor(account, label, allow) {
  const policyId = await policyFor(account, label, allow);
  const a = await call("POST", "/agents", { cookie, body: { name: `${label} agent`, chain_id: CHAIN, account, policy_id: policyId } });
  const k = await call("POST", `/agents/${a.body.id}/credentials`, { cookie, body: { label: "default" } });
  return { agentId: a.body.id, key: k.body.secret };
}
const S = await agentFor(safe, "safe", recipient);
check(`setup: agent registered with the Safe as its account (${KEY_PREFIX} key)`, (S.key ?? "").startsWith(KEY_PREFIX), S);

const transfer = "0xa9059cbb" + "00".repeat(64);
const now = () => Math.floor(Date.now() / 1000);
const intent = (over = {}) => ({ request_id: `sa-${crypto.randomUUID()}`, chain_id: CHAIN, to: recipient, value_wei: parseEther("0.001").toString(), data: transfer, gas_limit: 200000, deadline: now() + 120, ...over });

{
  const r = await call("GET", `/smart-accounts/${safe}`, { key: S.key });
  check("inspect: the Safe is enforced (threshold 2, PALISEC an owner, module on)", r.status === 200 && r.body.enforced && r.body.threshold === 2 && r.body.owners.length === 3 && r.body.palisec_is_owner, r.body);
  const list = await call("GET", `/smart-accounts?chain_id=${CHAIN}`, { cookie });
  check("console list: the agent's account shows as enforced", list.body.agents?.some((a) => a.agent_id === S.agentId && a.account?.enforced), list.body.agents);
}

// ---- the happy path, by hand ------------------------------------------------------------------------
const op = await call("POST", "/operations", { key: S.key, body: intent() });
check("operation allowed", op.status === 201 && op.body.decision === "ALLOW", op.body);
const id = op.body.operation_id;
const prep = await call("POST", `/operations/${id}/user-operation`, { key: S.key });
check("prepare: returns typed data, hash and a bounded cost", prep.status === 200 && /^0x[0-9a-f]{64}$/.test(prep.body.safe_op_hash) && BigInt(prep.body.max_cost_wei) > 0n, prep.body);
const u = prep.body.user_operation;
const typed = {
  domain: { chainId: CHAIN, verifyingContract: MODULE },
  types: { SafeOp: prep.body.typed_data.types.SafeOp },
  primaryType: "SafeOp",
  message: {
    safe: u.sender, nonce: BigInt(u.nonce), initCode: "0x", callData: u.callData,
    verificationGasLimit: BigInt(u.verificationGasLimit), callGasLimit: BigInt(u.callGasLimit), preVerificationGas: BigInt(u.preVerificationGas),
    maxPriorityFeePerGas: BigInt(u.maxPriorityFeePerGas), maxFeePerGas: BigInt(u.maxFeePerGas), paymasterAndData: "0x",
    validAfter: u.validAfter, validUntil: u.validUntil, entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  },
};
check("prepare: the hash is the typed data's EIP-712 hash", hashTypedData(typed) === prep.body.safe_op_hash, { local: hashTypedData(typed), api: prep.body.safe_op_hash });
check("prepare: the call is exactly the evaluated target and value (operation 0)",
  u.callData.toLowerCase().includes(recipient.slice(2).toLowerCase()) && u.callData.startsWith("0x7bb37428") && u.validUntil === Math.floor(new Date(op.body.expires_at).getTime() / 1000), u);
{
  const bad = await call("POST", `/operations/${id}/submit`, { key: S.key, body: { signature: await stranger.signTypedData(typed) } });
  check("submit: a signature from a non-owner is refused", bad.status === 403 && bad.body.error?.code === "PS_AUTH_003", bad.body);
  const extra = await call("POST", `/operations/${id}/submit`, { key: S.key, body: { signature: "0x00", note: "x" } });
  check("submit: unknown fields are refused", extra.status === 400, extra.body);
}
const before = await pub.getBalance({ address: recipient });
const sub = await call("POST", `/operations/${id}/submit`, { key: S.key, body: { signature: await agentKey.signTypedData(typed) } });
check("submit: PALISEC co-signs and the bundler accepts", sub.status === 202 && /^0x[0-9a-f]{64}$/i.test(sub.body.user_op_hash ?? ""), sub.body);
const ex = await call("GET", `/operations/${id}/execution`, { key: S.key });
check("execution: executed on chain with a transaction hash", ex.status === 200 && ex.body.status === "executed" && /^0x[0-9a-f]{64}$/.test(ex.body.transaction_hash ?? ""), ex.body);
check("chain: the recipient received exactly the authorized value", (await pub.getBalance({ address: recipient })) - before === parseEther("0.001"));
{
  const again = await call("POST", `/operations/${id}/submit`, { key: S.key, body: { signature: await agentKey.signTypedData(typed) } });
  check("submit: an operation executes at most once", again.status === 409, again.body);
  const reprep = await call("POST", `/operations/${id}/user-operation`, { key: S.key });
  check("prepare: refused after submission", reprep.status === 409, reprep.body);
  const read = await call("GET", `/operations/${id}`, { key: S.key });
  check("operation: carries the transaction hash and execution record", read.body.transaction_hash === ex.body.transaction_hash && read.body.details?.execution?.success === true, read.body);
  const audit = await call("GET", "/audit-events", { cookie });
  const types = (audit.body.events ?? []).map((e) => e.type);
  check("audit: co-signature and execution are recorded", types.includes("operation.cosigned") && types.includes("operation.executed"), types.slice(0, 12));
  const memberView = await call("GET", `/operations/${id}/execution`, { cookie });
  check("members can read execution status", memberView.status === 200 && memberView.body.status === "executed", memberView.body);
}

// ---- refusals -------------------------------------------------------------------------------------
{
  const denied = await call("POST", "/operations", { key: S.key, body: intent({ to: stranger.address }) });
  check("a denied operation is denied", denied.body.decision === "DENY", denied.body);
  const p = await call("POST", `/operations/${denied.body.operation_id}/user-operation`, { key: S.key });
  check("prepare: a denied operation cannot be executed", p.status === 409 && p.body.error?.code === "PS_AUTH_002", p.body);

  const held = await call("POST", "/operations", { key: S.key, body: intent({ value_wei: parseEther("0.04").toString() }) });
  if (held.body.state === "pending_approval") {
    const hp = await call("POST", `/operations/${held.body.operation_id}/user-operation`, { key: S.key });
    check("prepare: an operation waiting for approval cannot be executed", hp.status === 409, hp.body);
  } else check("held operation is pending approval", false, held.body);

  const plain = privateKeyToAccount(generatePrivateKey());
  const P = await agentFor(plain.address, "plain", recipient);
  const pop = await call("POST", "/operations", { key: P.key, body: intent() });
  const pp = await call("POST", `/operations/${pop.body.operation_id}/user-operation`, { key: P.key });
  check("prepare: a plain-key account is refused (not enforceable)", pop.body.decision === "ALLOW" && pp.status === 409 && pp.body.error?.code === "PS_ACCOUNT_001", pp.body);

  const other = await call("POST", `/operations/${id}/user-operation`, { key: P.key });
  check("another agent cannot prepare this agent's operation", other.status === 404, other.status);
  const noKey = await call("POST", `/operations/${pop.body.operation_id}/user-operation`, {});
  check("unauthenticated prepare is refused", noKey.status === 401, noKey.status);
}

// ---- the SDK does all of it -----------------------------------------------------------------------
{
  const client = createPalisec({ apiKey: S.key, baseUrl: `${BASE}/api/v1` });
  const before2 = await pub.getBalance({ address: recipient });
  const { operation, execution } = await client.executeWithSmartAccount(agentKey, { to: recipient, value: parseEther("0.002"), data: transfer, gasLimit: 200000 });
  check("SDK executeWithSmartAccount: allowed, co-signed, executed", operation.decision === "ALLOW" && execution.status === "executed" && /^0x[0-9a-f]{64}$/.test(execution.transactionHash ?? ""), execution);
  check("SDK: the recipient received the value", (await pub.getBalance({ address: recipient })) - before2 === parseEther("0.002"));
}

const health = await fetch(`${BASE}/api/v1/health`).then((r) => r.json());
const signerState = CHAIN === 4663 ? health.components?.mainnet_signer === "mainnet_cosigner" : health.components?.signer === "testnet_cosigner";
check("health: signer and bundler reported as configured, values never shown", signerState && health.components?.bundler === "configured" && health.features?.smart_accounts === true && !JSON.stringify(health).includes("alchemy"), health.components);
if (CHAIN === 4663) {
  // Mainnet never shares the testnet co-signer.
  const test = await call("GET", "/smart-accounts?chain_id=46630", { cookie });
  check("mainnet: its co-signer is a different key from testnet's", test.status === 200 && test.body.palisec_signer !== palisec, { mainnet: palisec, testnet: test.body.palisec_signer });
  check("health: mainnet listed as enabled and the default network", health.default_chain === 4663 && health.chains?.some((c) => c.chain_id === 4663 && c.enabled && c.smart_accounts), health.chains);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
