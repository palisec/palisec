#!/usr/bin/env node
/**
 * Phase 6.5 end to end against a deployment: the "must be recoverable on Upoch" rule (schema 1.2) and the
 * agent's Upoch status, with real Upoch reads on mainnet. Dry runs only (POST /v1/authorizations/evaluate):
 * nothing is recorded, reserved or sent. The agent is the Palisec demo smart account; its Upoch workflow
 * is WORKFLOW (owner: the checkpoint key; guardian: the company wallet, a recovery owner of the account).
 *
 *   BASE_URL=http://localhost:3002 WORKFLOW=10 node apps/web/scripts/e2e-phase65.mjs   (test server with 3 s delays)
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.BASE_URL ?? "https://palisec.tech";
const WORKFLOW = process.env.WORKFLOW ?? "10";
const OTHER_WORKFLOW = "9"; // someone else's workflow: exists, not linked to our account
const SAFE = "0x375BdF5DA6b7440889e50f13C894A3C4AC988329";
const GUARDIAN = "0x989EfcD8Ad76E695CFD5ba915b1b12118471c430";
const TARGET = "0x000000000000000000000000000000000000dEaD";
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
async function org(label, { guardianMember = false } = {}) {
  const owner = privateKeyToAccount(generatePrivateKey());
  const c = await call("POST", "/auth/challenges", { body: { address: owner.address, chain_id: 4663 } });
  const v = await call("POST", "/auth/verify", { body: { nonce: c.body.nonce, signature: await owner.signMessage({ message: c.body.message }) } });
  const cookie = (v.headers.get("set-cookie") ?? "").split(";")[0];
  // Only owners/admins who have been members for the loosening delay can link a workflow (3 s on a test
  // server; 60 min in production, where the company wallet is the original owner and links at once).
  if (guardianMember) {
    await call("POST", "/members", { cookie, body: { address: GUARDIAN, role: "admin" } });
    await new Promise((res) => setTimeout(res, Number(process.env.LINK_WAIT_SECONDS ?? 4) * 1000));
  }
  const p = await call("POST", "/policies", { cookie, body: { name: label, policy_key: `p65_${label}_${Date.now()}`, chain_id: 4663, account: SAFE } });
  const base = {
    ...p.body.draft,
    schema_version: "1.2",
    asset_safety: { ...p.body.draft.asset_safety, enabled: false },
    limits: { ...p.body.draft.limits, max_price_age_seconds: 600 },
    cooldowns: { identical_calldata_seconds: 0, identical_intent_seconds: 0 },
    contracts: { default: "deny", allowlist: [{ address: TARGET, selectors: [], require_verified_code: false }], denylist: [] },
    human_approval: { usd_threshold_micros: "999999999999", require_for_unknown_methods: false },
    upoch_recovery: { require_upoch_recoverable: false, max_checkpoint_age_seconds: 604800, require_guardian: true, on_unavailable: "deny" },
  };
  const activate = async (doc) => {
    const s = await call("PUT", `/policies/${p.body.id}`, { cookie, body: { document: doc } });
    return call("POST", `/policies/${p.body.id}/activate`, { cookie, body: { confirm: true, draft_hash: s.body.draft_hash } });
  };
  await activate(base);
  const ag = await call("POST", "/agents", { cookie, body: { name: `Upoch ${label}`, chain_id: 4663, account: SAFE, policy_id: p.body.id } });
  const key = (await call("POST", `/agents/${ag.body.id}/credentials`, { cookie, body: {} })).body.secret;
  const dry = () => call("POST", "/authorizations/evaluate", { key, body: { request_id: `p65-${label}-${Date.now()}`, chain_id: 4663, to: TARGET, value_wei: "0", data: "0x", gas_limit: 21000, deadline: Math.floor(Date.now() / 1000) + 120 } });
  return { cookie, policyId: p.body.id, agentId: ag.body.id, base, activate, dry };
}
const rec = (r) => r.body.checks?.find((c) => c.id === "recovery");
const show = (label, r) => console.log(`      ${label}: ${r.body.decision} ${r.body.reason_code ?? ""} | ${rec(r)?.detail ?? r.body.message ?? JSON.stringify(r.body.error)}`);

// 1) No workflow set.
const A = await org("none");
let r = await A.activate({ ...A.base, upoch_recovery: { ...A.base.upoch_recovery, require_upoch_recoverable: true } });
check("turning the Upoch rule on is a tightening (applies at once)", r.body.state === "active", r.body.state);
r = await A.dry();
show("no workflow", r);
check("no Upoch workflow -> DENY PS_RECOVERY_001", r.body.reason_code === "PS_RECOVERY_001", r.body);

// 2) Someone else's workflow: exists, not linked to this account's members.
const B = await org("other");
await call("PATCH", `/agents/${B.agentId}`, { cookie: B.cookie, body: { upoch_workflow_id: OTHER_WORKFLOW } });
await B.activate({ ...B.base, upoch_recovery: { ...B.base.upoch_recovery, require_upoch_recoverable: true } });
r = await B.dry();
show(`workflow ${OTHER_WORKFLOW} (not ours)`, r);
check("a workflow not linked to the account -> DENY PS_RECOVERY_001", r.body.reason_code === "PS_RECOVERY_001" && /not linked/.test(rec(r)?.detail ?? ""), r.body);

// 3) Our workflow, linked through the guardian (a member and a recovery owner of the account).
const C = await org("ours", { guardianMember: true });
await call("PATCH", `/agents/${C.agentId}`, { cookie: C.cookie, body: { upoch_workflow_id: WORKFLOW } });
await C.activate({ ...C.base, upoch_recovery: { ...C.base.upoch_recovery, require_upoch_recoverable: true } });
r = await C.dry();
show(`workflow ${WORKFLOW} (ours)`, r);
check("recoverable on Upoch -> ALLOW, with the checkpoint numbers", r.body.decision === "ALLOW" && /checkpoint\(s\), last \d+s ago, 1 guardian/.test(rec(r)?.detail ?? ""), r.body);
const st = await call("GET", `/agents/${C.agentId}/upoch`, { cookie: C.cookie });
console.log(`      agent page status: ${JSON.stringify(st.body)}`);
check("agent Upoch status: recoverable, last checkpoint in UTC, guardians, link", st.body.recoverable === true && /Z$/.test(st.body.last_checkpoint_at ?? "") && st.body.guardians === 1 && st.body.upoch_url === `https://upoch.tech/app/agents/${WORKFLOW}`, st.body);
check("Upoch Score shown as unknown (no public endpoint), never guessed", st.body.upoch_score === null);

// 4) Checkpoint too old for a stricter policy (lowering the age is a tightening: applies at once).
r = await C.activate({ ...C.base, upoch_recovery: { ...C.base.upoch_recovery, require_upoch_recoverable: true, max_checkpoint_age_seconds: 60 } });
check("lowering the accepted checkpoint age applies at once", r.body.state === "active", r.body.state);
const age = st.body.last_checkpoint_age_seconds ?? 0;
if (age <= 60) await new Promise((res) => setTimeout(res, (62 - age) * 1000));
r = await C.dry();
show("max age 60 s", r);
check("checkpoint older than the policy allows -> DENY PS_RECOVERY_002", r.body.reason_code === "PS_RECOVERY_002", r.body);

// 5) Turning the rule off is a loosening: it waits out the delay.
r = await C.activate({ ...C.base, upoch_recovery: { ...C.base.upoch_recovery, require_upoch_recoverable: false } });
check("turning the Upoch rule off waits out the loosening delay", r.body.state === "pending_activation", r.body.state);
// 6) Changing the workflow while the rule is on waits too.
r = await call("PATCH", `/agents/${C.agentId}`, { cookie: C.cookie, body: { upoch_workflow_id: OTHER_WORKFLOW } });
check("changing the agent's workflow under the rule waits out the delay", r.body.pending_change?.kind === "agent_upoch" && r.body.upoch_workflow_id === WORKFLOW, r.body.pending_change ?? r.body);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
