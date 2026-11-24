#!/usr/bin/env node
/**
 * Policy registry v3 (the stop hold): moves the two demo smart accounts (mandate demo 0x9aEC…170c, loss-limits demo
 * 0x6677…FD77) from the v2 registry to v3, through Palisec like any other operation. Keys are read from the company key files
 * outside the repository and are never printed.
 *   allow      owner: allow v3's declare() in each policy (and the mandate envelope): loosenings, they wait the delay
 *   declare    agent: each Safe calls v3.declare(co-signer, publisher, receipt signer, 900 s, co-signer type) (co-signed)
 *   sync       publish each account's commitments now (POST /v1/public/peaa/sync)
 *   status     what both registries say (library only)
 *
 *   node apps/web/scripts/registry-move.mjs <stage> [mandate|loss]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createPublicClient, encodeFunctionData, http, toFunctionSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createPalisec } from "../../../packages/sdk/dist/index.js";
import { REGISTRY_ABI, REGISTRY_ADDRESSES, REGISTRY_V2_ADDRESSES, readAccount } from "../../../packages/policy-enforced-accounts/dist/index.js";

const BASE = process.env.BASE_URL ?? "https://palisec.tech";
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const EXPLORER = "https://robinhoodchain.blockscout.com";
const REGISTRY = REGISTRY_ADDRESSES[4663];
const V2 = REGISTRY_V2_ADDRESSES[4663];
const DECLARE = toFunctionSelector("declare(address,address,address,uint32,uint8)");
const COSIGNER = "0x628FdA166280b9E2C5E5FBD89fDDDaCe626d8ec7";
const MIN_DELAY = 900;
const SIGNER_TYPE = 1; // co-signer in the signature path (a Safe owner)
const pg = (f) => JSON.parse(readFileSync(`${homedir()}/palisec-pg/${f}`, "utf8"));
const keys = pg("registry-keys.json");
const publisher = privateKeyToAccount(keys.publisher).address;
const receiptSigner = privateKeyToAccount(keys.receipt).address;
const pub = createPublicClient({ transport: http(RPC) });
const utc = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

const ACCOUNTS = {
  mandate: (() => {
    const d = pg("mandate-demo.json");
    const p = pg("mandate-proof.json");
    return { owner: d.owner, agent: d.agent, safe: p.safe, policyId: p.policy_id, apiKey: p.api_key, mandateId: p.mandate_id };
  })(),
  loss: (() => {
    const k = pg("loss-demo-keys.json");
    const s = pg("loss-demo-state.json");
    return { owner: k.owner, agent: k.agent, safe: s.safe, policyId: s.policy_id, apiKey: s.api_key, mandateId: null };
  })(),
};

async function call(method, path, { cookie, body } = {}) {
  const h = { origin: BASE };
  if (body !== undefined) h["content-type"] = "application/json";
  if (cookie) h.cookie = cookie;
  const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
}
async function signIn(ownerKey) {
  const owner = privateKeyToAccount(ownerKey);
  const c = await call("POST", "/auth/challenges", { body: { address: owner.address, chain_id: 4663 } });
  const v = await call("POST", "/auth/verify", { body: { nonce: c.body.nonce, signature: await owner.signMessage({ message: c.body.message }) } });
  return (v.headers.get("set-cookie") ?? "").split(";")[0];
}
const has = (list, addr) => list.some((c) => c.address.toLowerCase() === addr.toLowerCase());

const [stage, only] = process.argv.slice(2);
const names = only ? [only] : Object.keys(ACCOUNTS);
for (const name of names) {
  const a = ACCOUNTS[name];
  if (!a) throw new Error(`unknown account ${name}`);
  if (stage === "allow") {
    const cookie = await signIn(a.owner);
    if (a.mandateId) {
      const m = await call("GET", `/mandates/${a.mandateId}`, { cookie });
      const env = structuredClone(m.body.envelope ?? m.body.mandate?.envelope);
      if (!has(env.allowed_contracts, REGISTRY)) {
        env.allowed_contracts.push({ address: REGISTRY, selectors: [DECLARE] });
        const e = await call("POST", `/mandates/${a.mandateId}/envelope`, { cookie, body: { envelope: env } });
        console.log(`${utc()}  ${name}: envelope ${e.status} ${e.body.pending_change ? `pending until ${e.body.pending_change.effective_at}` : "applied"}`);
      }
    }
    const p = await call("GET", `/policies/${a.policyId}`, { cookie });
    const doc = structuredClone(p.body.pending?.policy_version ? p.body.draft : p.body.active_document);
    delete doc.version;
    delete doc.status;
    if (has(doc.contracts.allowlist, REGISTRY)) {
      console.log(`${utc()}  ${name}: policy already allows v3 declare()`);
      continue;
    }
    doc.contracts.allowlist.push({ address: REGISTRY, selectors: [DECLARE], require_verified_code: true });
    const s = await call("PUT", `/policies/${a.policyId}`, { cookie, body: { document: doc } });
    if (s.status !== 200) throw new Error(`${name} save draft: ${s.status} ${JSON.stringify(s.body).slice(0, 300)}`);
    const r = await call("POST", `/policies/${a.policyId}/activate`, { cookie, body: { confirm: true, draft_hash: s.body.draft_hash } });
    if (r.status !== 200) throw new Error(`${name} activate: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    console.log(`${utc()}  ${name}: policy v${r.body.activated_version} ${r.body.state}${r.body.effective_at ? `, effective ${r.body.effective_at}` : ""}`);
  } else if (stage === "declare") {
    const palisec = createPalisec({ apiKey: a.apiKey, chainId: 4663, baseUrl: `${BASE}/api/v1` });
    const data = encodeFunctionData({ abi: REGISTRY_ABI, functionName: "declare", args: [COSIGNER, publisher, receiptSigner, MIN_DELAY, SIGNER_TYPE] });
    const { operation, execution } = await palisec.executeWithSmartAccount(privateKeyToAccount(a.agent), { to: REGISTRY, value: 0n, data, gasLimit: 250000 });
    let ex = execution;
    const until = Date.now() + 180_000;
    while (ex.status === "submitted" && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 3000));
      ex = await palisec.getExecution(operation.operationId);
    }
    console.log(`${utc()}  ${name}: declare ${operation.decision}${operation.reasonCode ? ` ${operation.reasonCode}` : ""} → ${ex.status} ${ex.transactionHash ? `${EXPLORER}/tx/${ex.transactionHash}` : ""}`);
  } else if (stage === "status") {
    const show = (s) => ({ standard: s.standard, enforced: s.enforced, publisher: s.publisher, minDelay: s.minDelay, signerType: s.signerType, policy: s.policy && { version: String(s.policy.version), hash: s.policy.policyHash, effectiveAt: String(s.policy.effectiveAt) }, pending: s.pending && { version: String(s.pending.version), effectiveAt: String(s.pending.effectiveAt) }, stopped: s.stopped, mandate: s.mandate?.uri ?? null });
    console.log(name, a.safe);
    console.log("  v3", JSON.stringify({ ...show(await readAccount(pub, a.safe, REGISTRY)), stopHeldByAccount: (await readAccount(pub, a.safe, REGISTRY)).stopHeldByAccount }));
    console.log("  v2", JSON.stringify(show(await readAccount(pub, a.safe, V2))));
  } else if (stage !== "sync") {
    console.error("stage: allow | declare | sync | status");
    process.exit(2);
  }
}
if (stage === "sync") {
  const r = await call("POST", "/public/peaa/sync");
  for (const x of r.body.results ?? []) console.log(`${utc()}  ${x.account}: ${x.sent.map((s) => `${s.kind} ${EXPLORER}/tx/${s.tx}`).join(" · ") || "nothing to send"}${x.skipped ? ` (${x.skipped})` : ""}${x.error ? " ERROR" : ""}`);
  if (r.status !== 200) console.log(r.status, JSON.stringify(r.body).slice(0, 300));
}
