#!/usr/bin/env node
/**
 * End-to-end check of the control plane and authorization API against a running deployment with a
 * database (spec §15.3, without the on-chain steps). Throwaway wallets are generated in memory.
 *
 *   BASE_URL=http://localhost:3000 node scripts/e2e-api.mjs
 *
 * Uses the live Robinhood Chain testnet RPC and price feed for fee and USD conversion, as production does.
 */
import { encodeFunctionData, erc20Abi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ORIGIN = new URL(BASE).origin;
const CHAIN = 46630;
let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) passed++;
  else failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || detail === undefined ? "" : `  -> ${JSON.stringify(detail).slice(0, 400)}`}`);
}

async function call(method, path, { cookie, key, body, origin = ORIGIN, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  if (cookie) h.cookie = cookie;
  if (key) h.authorization = `Bearer ${key}`;
  if (origin) h.origin = origin;
  const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json, headers: res.headers };
}

async function signIn(account) {
  const c = await call("POST", "/auth/challenges", { body: { address: account.address, chain_id: CHAIN } });
  const signature = await account.signMessage({ message: c.body.message });
  const v = await call("POST", "/auth/verify", { body: { nonce: c.body.nonce, signature } });
  const cookie = (v.headers.get("set-cookie") ?? "").split(";")[0];
  return { cookie, status: v.status };
}

const transfer = (to, amount) => encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] });
const approveData = (to) => encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [to, 1n] });
const rand = () => privateKeyToAccount(generatePrivateKey()).address;
const now = () => Math.floor(Date.now() / 1000);

const owner = privateKeyToAccount(generatePrivateKey());
const viewer = privateKeyToAccount(generatePrivateKey());
const outsider = privateKeyToAccount(generatePrivateKey());
const ACCOUNT = rand();
const TOKEN = rand();

// ---------------------------------------------------------------- sign-in and organization
const o = await signIn(owner);
check("owner signs in", o.status === 200 && o.cookie.includes("="), o);
const me = await call("GET", "/me", { cookie: o.cookie });
check("owner has an organization as owner", me.body.organizations?.[0]?.role === "owner", me.body);

check("anonymous agent list is refused", (await call("GET", "/agents")).status === 401);
check("state change without Origin is refused (CSRF)", (await call("POST", "/agents", { cookie: o.cookie, origin: null, body: {} })).status === 403);

// ---------------------------------------------------------------- policy lifecycle
let r = await call("POST", "/policies", { cookie: o.cookie, body: { name: "Treasury bot", policy_key: "treasury_bot", chain_id: CHAIN, account: ACCOUNT } });
check("create policy draft", r.status === 201 && r.body.status === "draft", r.body);
const policyId = r.body.id;
check("duplicate policy key is refused", (await call("POST", "/policies", { cookie: o.cookie, body: { name: "x", policy_key: "treasury_bot", chain_id: CHAIN, account: ACCOUNT } })).status === 409);

const draft = {
  ...r.body.draft,
  limits: { ...r.body.draft.limits, max_transaction_value_wei: "1000000000000000", hourly_budget_usd_micros: "500000", max_pending_operations: 10, max_price_age_seconds: 120 },
  cooldowns: { identical_calldata_seconds: 60, identical_intent_seconds: 0 },
  contracts: { default: "deny", allowlist: [{ address: TOKEN, selectors: ["0xa9059cbb"], require_verified_code: false }], denylist: [] },
  human_approval: { usd_threshold_micros: "100000000", require_for_unknown_methods: true },
};
r = await call("PUT", `/policies/${policyId}`, { cookie: o.cookie, body: { document: { ...draft, limits: { ...draft.limits, bogus: 1 } } } });
check("invalid draft is saved but reports errors", r.status === 200 && r.body.draft_errors.length > 0, r.body.draft_errors);
r = await call("POST", `/policies/${policyId}/activate`, { cookie: o.cookie, body: { confirm: true, draft_hash: r.body.draft_hash } });
check("invalid draft cannot be activated", r.status === 422, r.body);
r = await call("PUT", `/policies/${policyId}`, { cookie: o.cookie, body: { document: draft } });
check("valid draft saved", r.status === 200 && r.body.draft_errors.length === 0, r.body.draft_errors);
const hash = r.body.draft_hash;
check("activation needs confirm", (await call("POST", `/policies/${policyId}/activate`, { cookie: o.cookie, body: { draft_hash: hash } })).status === 400);
check("activation with a stale hash is refused", (await call("POST", `/policies/${policyId}/activate`, { cookie: o.cookie, body: { confirm: true, draft_hash: "0".repeat(64) } })).status === 409);
r = await call("POST", `/policies/${policyId}/activate`, { cookie: o.cookie, body: { confirm: true, draft_hash: hash } });
check("activate version 1", r.status === 200 && r.body.active_version === 1 && r.body.active_document?.status === "active", r.body);

// ---------------------------------------------------------------- agent and API key
r = await call("POST", "/agents", { cookie: o.cookie, body: { name: "Rebalancer", chain_id: CHAIN, account: rand(), policy_id: policyId } });
check("agent bound to a policy for another account is refused", r.status === 400, r.body);
r = await call("POST", "/agents", { cookie: o.cookie, body: { name: "Rebalancer", chain_id: CHAIN, account: ACCOUNT, policy_id: policyId } });
check("create agent", r.status === 201 && r.body.status === "active", r.body);
const agentId = r.body.id;
r = await call("POST", `/agents/${agentId}/credentials`, { cookie: o.cookie, body: { label: "e2e" } });
check("create API key (secret shown once)", r.status === 201 && /^rw_test_[0-9a-f]{48}$/.test(r.body.secret), r.body);
const KEY = r.body.secret;
const credId = r.body.id;
r = await call("GET", `/agents/${agentId}`, { cookie: o.cookie });
check("key listing never includes the secret", r.status === 200 && !JSON.stringify(r.body).includes(KEY) && r.body.credentials.length === 1, r.body);

// ---------------------------------------------------------------- evaluation
const intent = (over = {}) => ({ request_id: `req_${Math.random().toString(36).slice(2)}`, chain_id: CHAIN, to: TOKEN, value_wei: "0", data: transfer(rand(), 5n), gas_limit: 100000, deadline: now() + 300, ...over });

check("bad API key is refused", (await call("POST", "/operations", { key: "rw_test_" + "0".repeat(48), body: intent() })).status === 401);
check("API key in a cookie session route is not a member", (await call("GET", "/operations", { key: KEY })).status === 400);
check("unknown request field is refused", (await call("POST", "/operations", { key: KEY, body: { ...intent(), from: ACCOUNT } })).status === 400);

r = await call("POST", "/authorizations/evaluate", { key: KEY, body: intent() });
check("dry run allows an allowlisted transfer", r.status === 200 && r.body.decision === "ALLOW" && r.body.dry_run === true && r.body.operation_id === null, r.body);

const first = intent({ value_wei: "100000000000000" });
r = await call("POST", "/operations", { key: KEY, body: first, headers: { "idempotency-key": "idem-1" } });
check("operation ALLOW reserves budget", r.status === 201 && r.body.decision === "ALLOW" && r.body.state === "authorized" && /^rw_auth_/.test(r.body.authorization_id), r.body);
check("transaction_hash stays null (nothing broadcast)", r.body.transaction_hash === null);
const allowedOp = r.body.operation_id;
r = await call("POST", "/operations", { key: KEY, body: first, headers: { "idempotency-key": "idem-1" } });
check("idempotent retry returns the same operation", r.status === 200 && r.body.operation_id === allowedOp && r.headers.get("idempotent-replayed") === "true", r.body);
r = await call("POST", "/operations", { key: KEY, body: { ...first, request_id: "other" }, headers: { "idempotency-key": "idem-1" } });
check("idempotency key reused for a different request is refused", r.status === 409 && r.body.error?.code === "RW_REPLAY_001", r.body);
r = await call("POST", "/operations", { key: KEY, body: first });
check("replayed request_id is refused", r.status === 409 && r.body.error?.code === "RW_REPLAY_001", r.body);
r = await call("POST", "/operations", { key: KEY, body: { ...first, request_id: "loop_1" } });
check("identical calldata within cooldown is RW_LOOP_001", r.body.decision === "DENY" && r.body.reason_code === "RW_LOOP_001", r.body);
r = await call("POST", "/operations", { key: KEY, body: intent({ to: rand() }) });
check("target not allowlisted is RW_TARGET_001", r.body.decision === "DENY" && r.body.reason_code === "RW_TARGET_001", r.body);
r = await call("POST", "/operations", { key: KEY, body: intent({ value_wei: "2000000000000000" }) });
check("value over the per-transaction limit is RW_BUDGET_001", r.body.reason_code === "RW_BUDGET_001", r.body);
r = await call("POST", "/operations", { key: KEY, body: intent({ deadline: now() - 1 }) });
check("expired deadline is RW_REPLAY_001", r.body.reason_code === "RW_REPLAY_001", r.body);
r = await call("POST", "/operations", { key: KEY, body: intent({ chain_id: 4663 }) });
check("wrong chain is denied", r.body.decision === "DENY", r.body);
r = await call("POST", "/operations", { key: KEY, body: intent({ data: approveData(rand()) }) });
check("unknown method goes to human review", r.status === 201 && r.body.decision === "REQUIRES_HUMAN_SIGNATURE" && r.body.state === "pending_approval" && r.body.authorization_id === null, r.body);
const pendingOp = r.body.operation_id;
r = await call("POST", "/operations", { key: KEY, body: intent({ data: approveData(rand()) }) });
const toReject = r.body.operation_id;

// Budget: $0.50 per hour. The first ALLOW used about $0.23; this asks for about $0.46 more.
r = await call("POST", "/operations", { key: KEY, body: intent({ value_wei: "200000000000000" }) });
check("hourly budget exhaustion is RW_BUDGET_001", r.body.reason_code === "RW_BUDGET_001", r.body);

// ---------------------------------------------------------------- approvals
r = await call("GET", "/approvals", { cookie: o.cookie });
const item = r.body.approvals?.find((a) => a.operation_id === pendingOp);
check("pending approval listed with EIP-712 data", !!item?.typed_data, r.body);
const typed = item.typed_data;
const message = { ...typed.message };
for (const k of ["chainId", "valueWei", "policyVersion", "expiresAt"]) message[k] = BigInt(message[k]);
const badSig = await outsider.signTypedData({ domain: typed.domain, types: { OperationApproval: typed.types.OperationApproval }, primaryType: typed.primaryType, message });
check("approval signed by another wallet is refused", (await call("POST", `/approvals/${pendingOp}/approve`, { cookie: o.cookie, body: { signature: badSig } })).status === 401);
const tampered = await owner.signTypedData({ domain: typed.domain, types: { OperationApproval: typed.types.OperationApproval }, primaryType: typed.primaryType, message: { ...message, valueWei: 1n } });
check("approval of a modified operation is refused", (await call("POST", `/approvals/${pendingOp}/approve`, { cookie: o.cookie, body: { signature: tampered } })).status === 401);
const goodSig = await owner.signTypedData({ domain: typed.domain, types: { OperationApproval: typed.types.OperationApproval }, primaryType: typed.primaryType, message });
r = await call("POST", `/approvals/${pendingOp}/approve`, { cookie: o.cookie, body: { signature: goodSig } });
check("approval with the approver's signature authorizes", r.status === 200 && r.body.state === "approved" && /^rw_auth_/.test(r.body.authorization_id), r.body);
check("approval cannot be reused", (await call("POST", `/approvals/${pendingOp}/approve`, { cookie: o.cookie, body: { signature: goodSig } })).status === 409);
r = await call("POST", `/approvals/${toReject}/reject`, { cookie: o.cookie, body: { reason: "not expected" } });
check("reject a pending operation", r.status === 200 && r.body.state === "rejected", r.body);
r = await call("GET", `/operations/${pendingOp}`, { key: KEY });
check("agent reads its approved operation", r.status === 200 && r.body.state === "approved", r.body);

// ---------------------------------------------------------------- cancel releases budget
r = await call("POST", `/operations/${allowedOp}/cancel`, { key: KEY });
check("agent cancels an unused authorization", r.status === 200 && r.body.state === "cancelled", r.body);
r = await call("POST", `/operations/${pendingOp}/cancel`, { key: KEY });
check("cancel the approved one too", r.status === 200, r.body);
r = await call("POST", "/operations", { key: KEY, body: intent({ value_wei: "150000000000000" }) });
check("released budget can be used again", r.body.decision === "ALLOW", r.body);
await call("POST", `/operations/${r.body.operation_id}/cancel`, { key: KEY });

// ---------------------------------------------------------------- concurrency: one slot, many requests
const p2 = await call("POST", "/policies", { cookie: o.cookie, body: { name: "Race", policy_key: "race_test", chain_id: CHAIN, account: ACCOUNT } });
const raceDraft = { ...draft, policy_id: "race_test", limits: { ...draft.limits, hourly_budget_usd_micros: "300000" } };
const saved = await call("PUT", `/policies/${p2.body.id}`, { cookie: o.cookie, body: { document: raceDraft } });
await call("POST", `/policies/${p2.body.id}/activate`, { cookie: o.cookie, body: { confirm: true, draft_hash: saved.body.draft_hash } });
const a2 = await call("POST", "/agents", { cookie: o.cookie, body: { name: "Racer", chain_id: CHAIN, account: ACCOUNT, policy_id: p2.body.id } });
const k2 = (await call("POST", `/agents/${a2.body.id}/credentials`, { cookie: o.cookie, body: {} })).body.secret;
const racers = await Promise.all(Array.from({ length: 30 }, () => call("POST", "/operations", { key: k2, body: intent({ value_wei: "100000000000000" }) })));
const allowed = racers.filter((x) => x.body.decision === "ALLOW").length;
const budgetDenied = racers.filter((x) => x.body.reason_code === "RW_BUDGET_001").length;
check(`30 concurrent requests for one budget slot: exactly 1 allowed (got ${allowed}, ${budgetDenied} budget-denied)`, allowed === 1 && budgetDenied === 29, racers.map((x) => x.body.reason_code ?? x.body.error));

// ---------------------------------------------------------------- pause, emergency stop, roles
check("pause needs confirmation", (await call("POST", `/agents/${agentId}/pause`, { cookie: o.cookie, body: {} })).status === 400);
r = await call("POST", `/agents/${agentId}/pause`, { cookie: o.cookie, body: { confirm: true } });
check("pause agent", r.status === 200 && r.body.status === "paused", r.body);
r = await call("POST", "/operations", { key: KEY, body: intent() });
check("paused agent is RW_PAUSED_001", r.body.reason_code === "RW_PAUSED_001", r.body);
r = await call("POST", `/agents/${agentId}/resume`, { cookie: o.cookie, body: { confirm: true } });
check("resume agent", r.status === 200 && r.body.status === "active", r.body);

r = await call("POST", "/organization/emergency-stop", { cookie: o.cookie, body: { active: true, confirm: true } });
check("emergency stop on", r.status === 200 && r.body.emergency_stop === true, r.body);
r = await call("POST", "/operations", { key: KEY, body: intent() });
check("emergency stop denies new operations", r.body.reason_code === "RW_PAUSED_001", r.body);

r = await call("POST", "/members", { cookie: o.cookie, body: { address: viewer.address, role: "viewer" } });
check("owner adds a viewer", r.status === 200 && r.body.members.length === 2, r.body);
const v = await signIn(viewer);
check("viewer signs in and joins the existing organization", (await call("GET", "/me", { cookie: v.cookie })).body.organizations?.some((x) => x.role === "viewer"));
const viewerOrg = me.body.organizations[0].id;
check("viewer can read agents", (await call("GET", "/agents", { cookie: v.cookie, headers: { "x-rw-org": viewerOrg } })).status === 200);
check("viewer cannot create agents", (await call("POST", "/agents", { cookie: v.cookie, headers: { "x-rw-org": viewerOrg }, body: { name: "x", chain_id: CHAIN, account: ACCOUNT } })).status === 403);
check("viewer cannot lift the emergency stop", (await call("POST", "/organization/emergency-stop", { cookie: v.cookie, headers: { "x-rw-org": viewerOrg }, body: { active: false, confirm: true } })).status === 403);
r = await call("POST", "/organization/emergency-stop", { cookie: o.cookie, body: { active: false, confirm: true } });
check("owner lifts the emergency stop", r.status === 200 && r.body.emergency_stop === false, r.body);

const x = await signIn(outsider);
check("another organization cannot see this agent", (await call("GET", `/agents/${agentId}`, { cookie: x.cookie })).status === 404);
check("another organization cannot read this operation", (await call("GET", `/operations/${allowedOp}`, { cookie: x.cookie })).status === 404);
check("another organization cannot select this organization", (await call("GET", "/agents", { cookie: x.cookie, headers: { "x-rw-org": viewerOrg } })).status === 403);

// ---------------------------------------------------------------- revocation and audit
r = await call("POST", `/credentials/${credId}/revoke`, { cookie: o.cookie });
check("revoke API key", r.status === 200, r.body);
check("revoked key is refused", (await call("POST", "/operations", { key: KEY, body: intent() })).status === 401);

r = await call("GET", "/audit-events?limit=200", { cookie: o.cookie });
const types = new Set((r.body.events ?? []).map((e) => e.type));
for (const t of ["policy.created", "policy.activated", "agent.created", "credential.created", "operation.authorized", "operation.denied", "operation.pending_approval", "operation.approved", "operation.rejected", "operation.cancelled", "agent.paused", "agent.resumed", "org.emergency_stop.activated", "org.emergency_stop.lifted", "member.role_set", "credential.revoked"])
  check(`audit records ${t}`, types.has(t));
r = await call("GET", "/summary", { cookie: o.cookie });
check("summary counts real operations", r.status === 200 && r.body.allowed >= 2 && r.body.denied >= 5 && r.body.timezone === "UTC", r.body);
r = await call("GET", "/operations?decision=DENY&limit=5", { cookie: o.cookie });
check("operations list filters by decision", r.status === 200 && r.body.operations.every((op) => op.decision === "DENY"), r.body);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
