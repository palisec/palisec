#!/usr/bin/env node
/**
 * Policy publishing mainnet demo on the mandate demo smart account 0x9aEC…170c (keys outside the repo, never printed):
 *   allow      owner: allow the registry's declare() in the mandate envelope and the policy (two loosenings, 60 min)
 *   declare    agent: the Safe calls registry.declare(co-signer, publisher, receipt signer) through Palisec (co-signed)
 *   sync       publish the account's commitments now (POST /v1/public/peaa/sync)
 *   loosen     owner: raise the hourly budget by $0.25 inside the envelope (a pending loosening → PolicyPending)
 *   receipt    agent: a recorded request above the limit (DENY, nothing sent); saves its signed receipt to receipt-demo.json in the current folder
 *   status     what the chain says (library only)
 *
 *   node apps/web/scripts/peaa-proof.mjs <stage>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createPublicClient, encodeFunctionData, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createPalisec } from "../../../packages/sdk/dist/index.js";
import { REGISTRY_ABI, REGISTRY_ADDRESSES, readAccount } from "../../../packages/policy-enforced-accounts/dist/index.js";

const BASE = process.env.BASE_URL ?? "https://palisec.tech";
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const REGISTRY = REGISTRY_ADDRESSES[4663];
const DECLARE = "0x98c5fdc5";
const COSIGNER = "0x628FdA166280b9E2C5E5FBD89fDDDaCe626d8ec7";
const COMPANY = "0x989EfcD8Ad76E695CFD5ba915b1b12118471c430";
const pg = (f) => JSON.parse(readFileSync(`${homedir()}/palisec-pg/${f}`, "utf8"));
const demo = pg("mandate-demo.json");
const proof = pg("mandate-proof.json");
const keys = pg("registry-keys.json");
const owner = privateKeyToAccount(demo.owner);
const agentKey = privateKeyToAccount(demo.agent);
const publisher = privateKeyToAccount(keys.publisher).address;
const receiptSigner = privateKeyToAccount(keys.receipt).address;
const SAFE = proof.safe;
const pub = createPublicClient({ transport: http(RPC) });
const utc = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

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
async function activate(cookie, mutate) {
  const p = await call("GET", `/policies/${proof.policy_id}`, { cookie });
  const doc = structuredClone(p.body.active_document);
  delete doc.version;
  delete doc.status;
  mutate(doc);
  const s = await call("PUT", `/policies/${proof.policy_id}`, { cookie, body: { document: doc } });
  if (s.status !== 200) throw new Error(`save draft: ${s.status} ${JSON.stringify(s.body).slice(0, 300)}`);
  const a = await call("POST", `/policies/${proof.policy_id}/activate`, { cookie, body: { confirm: true, draft_hash: s.body.draft_hash } });
  if (a.status !== 200) throw new Error(`activate: ${a.status} ${JSON.stringify(a.body).slice(0, 300)}`);
  console.log(`${utc()}  policy v${a.body.activated_version}: ${a.body.state}${a.body.effective_at ? `, effective ${a.body.effective_at}` : ""}`);
}

const stage = process.argv[2];
if (stage === "allow") {
  const cookie = await signIn();
  const m = await call("GET", `/mandates/${proof.mandate_id}`, { cookie });
  const env = structuredClone(m.body.envelope ?? m.body.mandate?.envelope);
  if (!env.allowed_contracts.some((c) => c.address.toLowerCase() === REGISTRY.toLowerCase())) {
    env.allowed_contracts.push({ address: REGISTRY, selectors: [DECLARE] });
    const e = await call("POST", `/mandates/${proof.mandate_id}/envelope`, { cookie, body: { envelope: env } });
    console.log(`${utc()}  envelope: ${e.status} ${e.body.pending_change ? `pending until ${e.body.pending_change.effective_at}` : "applied"}`);
  }
  await activate(cookie, (doc) => {
    if (!doc.contracts.allowlist.some((c) => c.address.toLowerCase() === REGISTRY.toLowerCase()))
      doc.contracts.allowlist.push({ address: REGISTRY, selectors: [DECLARE], require_verified_code: true });
  });
} else if (stage === "declare") {
  const palisec = createPalisec({ apiKey: proof.api_key, chainId: 4663, baseUrl: `${BASE}/api/v1` });
  const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: "declare", args: [COSIGNER, publisher, receiptSigner] });
  const { operation, execution } = await palisec.executeWithSmartAccount(agentKey, { to: REGISTRY, value: 0n, data, gasLimit: 200000 });
  let ex = execution;
  const until = Date.now() + 180_000;
  while (ex.status === "submitted" && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000));
    ex = await palisec.getExecution(operation.operationId);
  }
  console.log(`${utc()}  declare: decision ${operation.operationId} ${operation.decision} → ${ex.status} ${ex.transactionHash ? `${EXPLORER}/tx/${ex.transactionHash}` : ""}`);
} else if (stage === "sync") {
  const r = await call("POST", "/public/peaa/sync");
  for (const x of r.body.results ?? []) console.log(`${utc()}  ${x.account}: ${x.sent.map((s) => `${s.kind} ${EXPLORER}/tx/${s.tx}`).join(" · ") || "nothing to send"}${x.skipped ? ` (${x.skipped})` : ""}${x.error ? " ERROR" : ""}`);
  if (r.status !== 200) console.log(r.status, JSON.stringify(r.body).slice(0, 300));
} else if (stage === "loosen") {
  const cookie = await signIn();
  await activate(cookie, (doc) => {
    doc.limits.hourly_budget_usd_micros = String(BigInt(doc.limits.hourly_budget_usd_micros) + 250000n);
  });
} else if (stage === "receipt") {
  const r = await call("POST", "/operations", {
    key: proof.api_key,
    body: { request_id: `peaa-receipt-${Date.now()}`, chain_id: 4663, to: COMPANY, value_wei: "20000000000000", data: "0x", gas_limit: 150000, deadline: Math.floor(Date.now() / 1000) + 300 },
  });
  if (!r.body.receipt) throw new Error(`no receipt: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  writeFileSync("receipt-demo.json", JSON.stringify(r.body.receipt, null, 2) + "\n");
  console.log(`${utc()}  decision ${r.body.operation_id} ${r.body.decision} ${r.body.reason_code ?? ""}: receipt saved (decision ${r.body.receipt.decision}, reason ${r.body.receipt.reasonCode}, policy ${r.body.receipt.policyHash.slice(0, 10)}…)`);
} else if (stage === "status") {
  console.log(JSON.stringify(await readAccount(pub, SAFE, REGISTRY), (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
} else {
  console.error("stage: allow | declare | sync | loosen | receipt | status");
  process.exit(2);
}
