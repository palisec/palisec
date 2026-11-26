#!/usr/bin/env node
/**
 * A second treasury guard demo account that is fully bound: its recovery owner is a timelock (OpenZeppelin
 * TimelockController 4.9.6) whose minimum delay outlasts the guard's lock, so nothing can be signed without
 * Palisec except through a public, delayed timelock operation. Keys and state stay outside the repository;
 * keys are never printed. Stages that send a transaction say so and need --send.
 *
 *   addresses              create the agent key (if missing) and print the timelock and Safe addresses to fund
 *   timelock [--send]      deployer: deploy the timelock (31-day minimum delay, executor: anyone)
 *   safe [--send]          deployer: create the Safe (agent key, Palisec co-signer, timelock; 2 of 3)
 *   policy                 policy with the treasury guard (Pons curve, 1,000 a day, locked 30 days), agent and API key
 *   declare [--send]       agent: the Safe declares Palisec on the ERC-8511 registry v3 (co-signed), then publish
 *   approve <tokens> [--send] · sell <tokens> [--send] · insider    as in proof-treasury.mjs
 *
 *   TIMELOCK_JSON=<path to TimelockController.json> node apps/web/scripts/proof-bound.mjs <stage> [arg] [--send]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, getContractAddress, http, parseAbi, parseUnits } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPalisec, safeOpTypedData } from "../../../packages/sdk/dist/index.js";
import { REGISTRY_ABI, REGISTRY_ADDRESSES } from "../../../packages/policy-enforced-accounts/dist/index.js";

const BASE = process.env.BASE_URL ?? "https://palisec.tech";
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const PALISEC = "0x1B4d04c8A67bf98BdF791EF928482bcB225d71AB";
const CURVE = "0x9f7383a2fcb30124A203D359e7a403F750a56501";
const COSIGNER = "0x628FdA166280b9E2C5E5FBD89fDDDaCe626d8ec7";
const FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const MODULE = "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226";
const MODULE_SETUP = "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47";
const REGISTRY = REGISTRY_ADDRESSES[4663];
const ZERO = "0x0000000000000000000000000000000000000000";
const APPROVE = "0x095ea7b3";
const TRANSFER = "0xa9059cbb";
const SELL = "0xd04c6983";
const TIMELOCK_DELAY = 31 * 86400;
const LOCK_DAYS = 30;
const CAP_TOKENS = 1000n;

const dir = `${homedir()}/palisec-pg`;
const statePath = `${dir}/bound-demo.json`;
const deployer = privateKeyToAccount(JSON.parse(readFileSync(`${dir}/loss-demo-keys.json`, "utf8")).owner);
const registryKeys = JSON.parse(readFileSync(`${dir}/registry-keys.json`, "utf8"));
const publisher = privateKeyToAccount(registryKeys.publisher).address;
const receiptSigner = privateKeyToAccount(registryKeys.receipt).address;
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
if (!state.agent_key) (state.agent_key = generatePrivateKey()), save();
const agentKey = privateKeyToAccount(state.agent_key);
const [stage, arg] = process.argv.slice(2).filter((a) => a !== "--send");
const SEND = process.argv.includes("--send");
const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account: deployer, chain, transport: http(RPC) });
const utc = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const tokens = (n) => parseUnits(String(n), 18);
const ERC20 = parseAbi(["function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const CURVE_ABI = parseAbi(["function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient)"]);
const FACTORY_ABI = parseAbi(["function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)"]);
const declareData = () => encodeFunctionData({ abi: REGISTRY_ABI, functionName: "declare", args: [COSIGNER, publisher, receiptSigner, 900, 1] });
const needSend = (what) => {
  if (SEND) return true;
  console.log(`${utc()}  preview: ${what}. Nothing sent; add --send to send it.`);
  return false;
};

async function call(method, path, { cookie, key, body } = {}) {
  const h = { origin: BASE };
  if (body !== undefined) h["content-type"] = "application/json";
  if (cookie) h.cookie = cookie;
  if (key) h.authorization = `Bearer ${key}`;
  const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
}
async function signIn() {
  const c = await call("POST", "/auth/challenges", { body: { address: deployer.address, chain_id: 4663 } });
  const v = await call("POST", "/auth/verify", { body: { nonce: c.body.nonce, signature: await deployer.signMessage({ message: c.body.message }) } });
  return (v.headers.get("set-cookie") ?? "").split(";")[0];
}

function safeInit(timelock) {
  return encodeFunctionData({
    abi: parseAbi(["function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)"]),
    functionName: "setup",
    args: [[agentKey.address, COSIGNER, timelock], 2n, MODULE_SETUP, encodeFunctionData({ abi: parseAbi(["function enableModules(address[] modules)"]), functionName: "enableModules", args: [[MODULE]] }), MODULE, ZERO, 0n, ZERO],
  });
}

/** Agent operation through Palisec: recorded decision, then the co-signed execution when allowed. */
async function op(label, to, data, assetIntent, gas = 300000) {
  const p = createPalisec({ apiKey: state.api_key, chainId: 4663, baseUrl: `${BASE}/api/v1` });
  const r = await call("POST", "/operations", { key: state.api_key, body: { request_id: `bound-${label}-${Date.now()}`, chain_id: 4663, to, value_wei: "0", data, ...(assetIntent ? { asset_intent: assetIntent } : {}), gas_limit: gas, deadline: Math.floor(Date.now() / 1000) + 300 } });
  let ex = null;
  if (r.body.decision === "ALLOW" && SEND) {
    const prepared = await p.prepareExecution(r.body.operation_id);
    ex = await p.submitExecution(r.body.operation_id, await agentKey.signTypedData(safeOpTypedData(prepared.userOperation, 4663)));
    const until = Date.now() + 180_000;
    while (ex?.status === "submitted" && Date.now() < until) {
      await new Promise((res) => setTimeout(res, 3000));
      ex = await p.getExecution(r.body.operation_id);
    }
  }
  const tx = ex?.transactionHash ? `${EXPLORER}/tx/${ex.transactionHash}` : null;
  console.log(`${utc()}  ${label}: decision ${r.body.operation_id} ${r.body.decision} ${r.body.reason_code ?? ""} ${r.body.decision === "ALLOW" ? "" : r.body.message ?? ""} → ${ex?.status ?? "not executed"} ${tx ?? ""}`);
  (state.proof ??= {})[label] = { at: utc(), operation_id: r.body.operation_id, decision: r.body.decision, reason_code: r.body.reason_code ?? null, tx };
  save();
}

if (stage === "addresses") {
  const nonce = await pub.getTransactionCount({ address: deployer.address });
  state.timelock ??= getContractAddress({ from: deployer.address, nonce: BigInt(nonce) });
  state.salt ??= String(Date.now());
  const { result } = await pub.simulateContract({ account: deployer, address: FACTORY, abi: FACTORY_ABI, functionName: "createProxyWithNonce", args: [SINGLETON, safeInit(state.timelock), BigInt(state.salt)] });
  state.safe = result;
  save();
  console.log(`deployer ${deployer.address}: ${formatEther(await pub.getBalance({ address: deployer.address }))} ETH\ntimelock (next deployment) ${state.timelock}\nSafe ${state.safe}\nagent key ${agentKey.address}`);
} else if (stage === "timelock") {
  const art = JSON.parse(readFileSync(process.env.TIMELOCK_JSON, "utf8"));
  const nonce = await pub.getTransactionCount({ address: deployer.address });
  if (getContractAddress({ from: deployer.address, nonce: BigInt(nonce) }).toLowerCase() !== state.timelock.toLowerCase()) throw new Error("the deployer's nonce moved: run addresses again before funding");
  if (!needSend(`deploy TimelockController (min delay ${TIMELOCK_DELAY / 86400} days, proposer and canceller ${deployer.address}, executor anyone) at ${state.timelock}`)) process.exit(0);
  const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode, args: [BigInt(TIMELOCK_DELAY), [deployer.address], [ZERO], ZERO] });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  Object.assign(state, { timelock: rcpt.contractAddress, timelock_tx: hash });
  save();
  console.log(`${utc()}  timelock ${rcpt.contractAddress}: ${EXPLORER}/tx/${hash}`);
} else if (stage === "safe") {
  if (!needSend(`create the Safe ${state.safe} (owners: agent key, Palisec co-signer, timelock; 2 of 3)`)) process.exit(0);
  const hash = await wallet.writeContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "createProxyWithNonce", args: [SINGLETON, safeInit(state.timelock), BigInt(state.salt)] });
  await pub.waitForTransactionReceipt({ hash });
  Object.assign(state, { safe_tx: hash });
  save();
  console.log(`${utc()}  Safe ${state.safe}: ${EXPLORER}/tx/${hash}`);
} else if (stage === "policy") {
  const cookie = await signIn();
  const p = await call("POST", "/policies", { cookie, body: { name: "Palisec treasury guard demo (fully bound)", policy_key: "palisec_bound_demo", chain_id: 4663, account: state.safe } });
  if (!p.body.id) throw new Error(JSON.stringify(p.body));
  const lockedUntil = Math.floor(Date.now() / 1000) + LOCK_DAYS * 86400;
  const doc = {
    ...p.body.draft,
    token_spend: undefined, // $PALISEC has no Chainlink price, so the spend rule would deny every $PALISEC sell
    limits: { ...p.body.draft.limits, max_transaction_value_wei: "0", hourly_budget_usd_micros: "5000000", max_price_age_seconds: 120 },
    cooldowns: { identical_calldata_seconds: 0, identical_intent_seconds: 0 },
    contracts: {
      default: "deny",
      allowlist: [
        { address: PALISEC, selectors: [APPROVE, TRANSFER], require_verified_code: true },
        { address: CURVE, selectors: [SELL], require_verified_code: true },
        { address: REGISTRY, selectors: [declareData().slice(0, 10)], require_verified_code: true },
      ],
      denylist: [],
    },
    human_approval: { usd_threshold_micros: "5000000", require_for_unknown_methods: false },
    treasury_guard: {
      enabled: true, project_token: PALISEC.toLowerCase(), allowed_destinations: [], allowed_sell_venues: [CURVE.toLowerCase()],
      daily_sell_cap: { amount: tokens(CAP_TOKENS).toString(), pct_of_holdings_bps: null }, approvals: "exact_to_venues",
      protect_liquidity: false, lp_tokens: [], locked_until: lockedUntil,
    },
  };
  const s = await call("PUT", `/policies/${p.body.id}`, { cookie, body: { document: doc } });
  if (s.body.draft_errors?.length) throw new Error(JSON.stringify(s.body.draft_errors));
  const a = await call("POST", `/policies/${p.body.id}/activate`, { cookie, body: { confirm: true, draft_hash: s.body.draft_hash } });
  const ag = await call("POST", "/agents", { cookie, body: { name: "Palisec treasury guard demo agent (fully bound)", chain_id: 4663, account: state.safe, policy_id: p.body.id } });
  const k = await call("POST", `/agents/${ag.body.id}/credentials`, { cookie, body: { label: "treasury guard proof" } });
  Object.assign(state, { policy_id: p.body.id, agent_id: ag.body.id, api_key: k.body.secret, locked_until: lockedUntil });
  save();
  console.log(`${utc()}  policy v${a.body.active_version} (${a.body.error ? JSON.stringify(a.body.error) : "active"}), agent ${ag.body.id} (${ag.body.status}), locked until ${new Date(lockedUntil * 1000).toISOString()}`);
} else if (stage === "declare") {
  if (!needSend("the Safe declares Palisec on the registry v3 (co-signed, gas from the Safe)")) process.exit(0);
  await op("declare", REGISTRY, declareData(), undefined, 250000);
  const r = await call("POST", "/public/peaa/sync");
  for (const x of r.body.results ?? []) if (x.account?.toLowerCase() === state.safe.toLowerCase()) console.log(`${utc()}  published: ${x.sent.map((s) => `${s.kind} ${EXPLORER}/tx/${s.tx}`).join(" · ") || x.skipped || "nothing"}`);
} else if (stage === "approve") {
  await op(`approve_${arg}`, PALISEC, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [CURVE, tokens(arg)] }), undefined, 120000);
} else if (stage === "sell") {
  await op(`sell_${arg}`, CURVE, encodeFunctionData({ abi: CURVE_ABI, functionName: "sell", args: [tokens(arg), 1n, state.safe] }), { spend: [{ token: PALISEC, amount: tokens(arg).toString() }], receive: [] }, 400000);
} else if (stage === "insider") {
  await op("insider", PALISEC, encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [privateKeyToAccount(generatePrivateKey()).address, tokens(1)] }));
} else {
  console.log("stages: addresses | timelock | safe | policy | declare | approve <tokens> | sell <tokens> | insider");
}
