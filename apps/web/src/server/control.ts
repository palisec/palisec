import "server-only";
import { SCHEMA_VERSION, validatePolicy, type Policy, type ValidationError } from "@palisec/policy-schema";
import type { MemberContext } from "./access";
import { CHAINS } from "./config";
import { db, type Row } from "./db";
import { BadRequest, HttpError } from "./http";
import type { Role } from "./session";
import { parseAddress } from "./siwe";
import { canonicalJson, randomHex, sha256Hex } from "./tokens";

/*
 * Control plane (spec §8.1, §11.3–11.7). Each change and its audit event are written by one SQL
 * statement, so they cannot diverge. Every query is scoped to the caller's organization.
 */

const notFound = (what: string) => new HttpError(404, "PS_REQUEST_001", `${what} not found in this organization`);
const conflict = (message: string) => new HttpError(409, "PS_REQUEST_001", message);

function text(v: unknown, field: string, max = 80): string {
  if (typeof v !== "string" || v.trim().length < 1 || v.trim().length > max) throw new BadRequest(`${field} must be 1-${max} characters`);
  return v.trim();
}

function chainId(v: unknown): number {
  if (typeof v !== "number" || !(v in CHAINS)) throw new BadRequest(`chain_id must be one of ${Object.keys(CHAINS).join(", ")}`);
  return v;
}

function requireConfirm(body: Record<string, unknown>) {
  if (body.confirm !== true) throw new BadRequest('This action needs explicit confirmation: send "confirm": true');
}

const audit = (type: string, detail: Record<string, unknown>) => ({ type, detail: JSON.stringify(detail) });

// ---------------------------------------------------------------- organization

export async function getOrganization(ctx: MemberContext) {
  const [o] = await db()`
    SELECT o.id, o.name, o.emergency_stop, o.created_at,
      (SELECT count(*) FROM agents WHERE org_id = o.id AND status <> 'revoked')::int AS agents,
      (SELECT count(*) FROM policies WHERE org_id = o.id)::int AS policies,
      (SELECT count(*) FROM memberships WHERE org_id = o.id)::int AS members
    FROM organizations o WHERE o.id = ${ctx.orgId}::uuid`;
  return { ...o, role: ctx.role };
}

export async function renameOrganization(ctx: MemberContext, body: Record<string, unknown>) {
  const name = text(body.name, "name");
  const a = audit("org.renamed", { name });
  await db()`
    WITH u AS (UPDATE organizations SET name = ${name} WHERE id = ${ctx.orgId}::uuid RETURNING id)
    INSERT INTO audit_events (org_id, actor_user_id, type, detail) SELECT id, ${ctx.user.userId}::uuid, ${a.type}, ${a.detail}::text::jsonb FROM u`;
  return getOrganization(ctx);
}

/** Turning the stop on is an operator action; turning it off needs the owner (spec §11.8). */
export async function setEmergencyStop(ctx: MemberContext, body: Record<string, unknown>) {
  requireConfirm(body);
  if (typeof body.active !== "boolean") throw new BadRequest("active must be true or false");
  if (!body.active && ctx.role !== "owner") throw new HttpError(403, "PS_AUTH_001", "Only an owner can lift the emergency stop");
  const a = audit(body.active ? "org.emergency_stop.activated" : "org.emergency_stop.lifted", {});
  await db()`
    WITH u AS (UPDATE organizations SET emergency_stop = ${body.active} WHERE id = ${ctx.orgId}::uuid AND emergency_stop <> ${body.active} RETURNING id)
    INSERT INTO audit_events (org_id, actor_user_id, type, detail) SELECT id, ${ctx.user.userId}::uuid, ${a.type}, ${a.detail}::text::jsonb FROM u`;
  return getOrganization(ctx);
}

// ---------------------------------------------------------------- members

const ROLE_NAMES: Role[] = ["owner", "admin", "operator", "approver", "viewer"];

export async function listMembers(ctx: MemberContext) {
  return db()`
    SELECT u.address, m.role, m.created_at, u.last_login FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.org_id = ${ctx.orgId}::uuid ORDER BY m.created_at`;
}

/** Adds a wallet address as a member, or changes its role. The person signs in with that wallet. */
export async function upsertMember(ctx: MemberContext, body: Record<string, unknown>) {
  const address = parseAddress(body.address);
  const role = body.role as Role;
  if (!ROLE_NAMES.includes(role)) throw new BadRequest(`role must be one of ${ROLE_NAMES.join(", ")}`);
  if (address.toLowerCase() === ctx.user.address.toLowerCase()) throw new BadRequest("You cannot change your own role");
  const a = audit("member.role_set", { address, role });
  await db()`
    WITH u AS (
      INSERT INTO users (address) VALUES (${address}) ON CONFLICT ((lower(address))) DO UPDATE SET address = users.address RETURNING id
    ), m AS (
      INSERT INTO memberships (org_id, user_id, role) SELECT ${ctx.orgId}::uuid, id, ${role} FROM u
      ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role RETURNING org_id
    )
    INSERT INTO audit_events (org_id, actor_user_id, type, detail) SELECT org_id, ${ctx.user.userId}::uuid, ${a.type}, ${a.detail}::text::jsonb FROM m`;
  return listMembers(ctx);
}

export async function removeMember(ctx: MemberContext, addressParam: string) {
  const address = parseAddress(addressParam);
  if (address.toLowerCase() === ctx.user.address.toLowerCase()) throw new BadRequest("You cannot remove yourself");
  const a = audit("member.removed", { address });
  const rows = await db()`
    WITH d AS (
      DELETE FROM memberships m USING users u
      WHERE m.user_id = u.id AND lower(u.address) = lower(${address}) AND m.org_id = ${ctx.orgId}::uuid RETURNING m.org_id
    )
    INSERT INTO audit_events (org_id, actor_user_id, type, detail) SELECT org_id, ${ctx.user.userId}::uuid, ${a.type}, ${a.detail}::text::jsonb FROM d RETURNING seq`;
  if (rows.length === 0) throw notFound("Member");
  return listMembers(ctx);
}

// ---------------------------------------------------------------- policies

/** A conservative starting draft: tiny limits, nothing allowlisted, unknown methods go to a human. */
export function starterPolicy(policyKey: string, chain: number, account: string): Policy {
  return {
    schema_version: SCHEMA_VERSION,
    policy_id: policyKey,
    version: 1,
    account: { chain_id: chain, address: account as `0x${string}` },
    status: "draft",
    limits: {
      max_transaction_value_wei: "10000000000000000",
      max_gas_cost_wei: "1000000000000000",
      hourly_budget_usd_micros: "50000000",
      max_pending_operations: 3,
      max_price_age_seconds: 60,
    },
    cooldowns: { identical_calldata_seconds: 60, identical_intent_seconds: 15 },
    contracts: { default: "deny", allowlist: [], denylist: [] },
    human_approval: { usd_threshold_micros: "25000000", require_for_unknown_methods: true },
    failure_mode: "closed",
  };
}

/** Validation for a draft: the document must be valid once activation sets its version and status. */
export function validateDraft(doc: unknown, policyKey: string): ValidationError[] {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return [{ path: "$", message: "policy must be an object" }];
  const errors = validatePolicy({ ...(doc as object), version: 1, status: "active" });
  if ((doc as Record<string, unknown>).policy_id !== policyKey)
    errors.push({ path: "$.policy_id", message: `must stay "${policyKey}"; create a new policy for a new ID` });
  return errors;
}

const draftHash = async (doc: unknown) => (doc ? sha256Hex(canonicalJson(doc)) : null);

export async function listPolicies(ctx: MemberContext) {
  const rows = await db()`
    SELECT p.id, p.policy_key, p.name, p.active_version, p.disabled_at, p.draft_updated_at, p.created_at, p.draft,
      pv.activated_at, pv.document->'account' AS account,
      (SELECT count(*) FROM agents a WHERE a.policy_id = p.id AND a.status <> 'revoked')::int AS agents
    FROM policies p LEFT JOIN policy_versions pv ON pv.policy_id = p.id AND pv.version = p.active_version
    WHERE p.org_id = ${ctx.orgId}::uuid ORDER BY p.created_at`;
  return rows.map(({ draft, ...p }) => ({
    ...p,
    status: p.disabled_at ? "disabled" : p.active_version ? "active" : "draft",
    draft_valid: draft ? validateDraft(draft, p.policy_key).length === 0 : null,
  }));
}

export async function getPolicy(ctx: MemberContext, id: string) {
  const [p] = await db()`
    SELECT p.*, u.address AS draft_updated_by_address FROM policies p LEFT JOIN users u ON u.id = p.draft_updated_by
    WHERE p.id = ${id}::uuid AND p.org_id = ${ctx.orgId}::uuid`;
  if (!p) throw notFound("Policy");
  const versions = await db()`
    SELECT v.version, v.document_hash, v.activated_at, u.address AS activated_by, v.document
    FROM policy_versions v LEFT JOIN users u ON u.id = v.activated_by
    WHERE v.policy_id = ${id}::uuid ORDER BY v.version DESC LIMIT 50`;
  const active = versions.find((v) => v.version === p.active_version) ?? null;
  return {
    id: p.id,
    policy_key: p.policy_key,
    name: p.name,
    status: p.disabled_at ? "disabled" : p.active_version ? "active" : "draft",
    active_version: p.active_version,
    disabled_at: p.disabled_at,
    draft: p.draft,
    draft_hash: await draftHash(p.draft),
    draft_errors: p.draft ? validateDraft(p.draft, p.policy_key) : [],
    draft_updated_at: p.draft_updated_at,
    draft_updated_by: p.draft_updated_by_address,
    active_document: active?.document ?? null,
    versions: versions.map(({ document, ...v }) => ({ ...v, account: document.account })),
  };
}

export async function createPolicy(ctx: MemberContext, body: Record<string, unknown>) {
  const name = text(body.name, "name");
  let doc: unknown = body.document;
  let key: string;
  if (doc !== undefined) {
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new BadRequest("document must be a policy object");
    key = String((doc as Record<string, unknown>).policy_id ?? "");
  } else {
    key = typeof body.policy_key === "string" ? body.policy_key : "";
    doc = starterPolicy(key, chainId(body.chain_id), parseAddress(body.account));
  }
  if (!/^[a-z0-9_]{3,64}$/.test(key)) throw new BadRequest("policy_key (the document's policy_id) must be 3-64 chars of a-z, 0-9, _");
  const a = audit("policy.created", { policy_key: key, name });
  const rows = await db()`
    WITH p AS (
      INSERT INTO policies (org_id, policy_key, name, draft, draft_updated_at, draft_updated_by, created_by)
      VALUES (${ctx.orgId}::uuid, ${key}, ${name}, ${JSON.stringify(doc)}::text::jsonb, now(), ${ctx.user.userId}::uuid, ${ctx.user.userId}::uuid)
      ON CONFLICT (org_id, policy_key) DO NOTHING RETURNING id, org_id
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, type, detail) SELECT org_id, ${ctx.user.userId}::uuid, ${a.type}, ${a.detail}::text::jsonb FROM p
    )
    SELECT id FROM p`;
  if (rows.length === 0) throw conflict(`A policy with ID ${key} already exists`);
  return getPolicy(ctx, rows[0].id);
}

export async function saveDraft(ctx: MemberContext, id: string, body: Record<string, unknown>) {
  const doc = body.document;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new BadRequest("document must be a policy object");
  const json = JSON.stringify(doc);
  if (json.length > 96 * 1024) throw new BadRequest("document is too large");
  const a = audit("policy.draft_saved", { policy_id: id });
  const rows = await db()`
    WITH p AS (
      UPDATE policies SET draft = ${json}::text::jsonb, draft_updated_at = now(), draft_updated_by = ${ctx.user.userId}::uuid
      WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid RETURNING id, org_id
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, type, detail) SELECT org_id, ${ctx.user.userId}::uuid, ${a.type}, ${a.detail}::text::jsonb FROM p
    )
    SELECT id FROM p`;
  if (rows.length === 0) throw notFound("Policy");
  return getPolicy(ctx, id);
}

/**
 * Activates the current draft as the next immutable version. The caller must send the hash of the
 * draft they reviewed, so a draft edited by someone else in the meantime cannot be activated blind.
 */
export async function activatePolicy(ctx: MemberContext, id: string, body: Record<string, unknown>) {
  requireConfirm(body);
  const current = await getPolicy(ctx, id);
  if (!current.draft) throw conflict("There is no draft to activate");
  if (body.draft_hash !== current.draft_hash) throw conflict("The draft changed since you reviewed it. Reload and review it again.");
  if (current.draft_errors.length) throw new HttpError(422, "PS_POLICY_001", `Draft is invalid: ${current.draft_errors[0]!.path} ${current.draft_errors[0]!.message}`);
  const next = (current.active_version ?? 0) + 1;
  const document = { ...(current.draft as object), version: next, status: "active" };
  const hash = await sha256Hex(canonicalJson(document));
  const a = audit("policy.activated", { policy_id: id, policy_key: current.policy_key, version: next, document_hash: hash });
  const rows = await db()`
    WITH p AS (
      UPDATE policies SET active_version = ${next}::int, disabled_at = NULL
      WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid AND active_version IS NOT DISTINCT FROM ${current.active_version}::int
        AND draft = ${JSON.stringify(current.draft)}::text::jsonb
      RETURNING id, org_id
    ), v AS (
      INSERT INTO policy_versions (policy_id, version, document, document_hash, activated_by)
      SELECT id, ${next}::int, ${JSON.stringify(document)}::text::jsonb, ${hash}, ${ctx.user.userId}::uuid FROM p RETURNING version
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, type, detail) SELECT org_id, ${ctx.user.userId}::uuid, ${a.type}, ${a.detail}::text::jsonb FROM p
    )
    SELECT version FROM v`;
  if (rows.length === 0) throw conflict("The policy changed while activating. Reload and try again.");
  return getPolicy(ctx, id);
}

export async function disablePolicy(ctx: MemberContext, id: string, body: Record<string, unknown>) {
  requireConfirm(body);
  const a = audit("policy.disabled", { policy_id: id });
  const rows = await db()`
    WITH p AS (
      UPDATE policies SET disabled_at = now() WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid AND disabled_at IS NULL RETURNING id, org_id
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, type, detail) SELECT org_id, ${ctx.user.userId}::uuid, ${a.type}, ${a.detail}::text::jsonb FROM p
    )
    SELECT id FROM p`;
  if (rows.length === 0) throw conflict("Policy not found or already disabled");
  return getPolicy(ctx, id);
}

// ---------------------------------------------------------------- agents

export async function listAgents(ctx: MemberContext) {
  return db()`
    SELECT a.id, a.name, a.chain_id, a.account, a.status, a.status_changed_at, a.created_at,
      p.id AS policy_id, p.policy_key, p.active_version AS policy_version, (p.disabled_at IS NOT NULL) AS policy_disabled,
      (SELECT count(*) FROM api_credentials c WHERE c.agent_id = a.id AND c.revoked_at IS NULL)::int AS active_keys,
      (SELECT max(created_at) FROM operations o WHERE o.agent_id = a.id) AS last_operation_at
    FROM agents a LEFT JOIN policies p ON p.id = a.policy_id
    WHERE a.org_id = ${ctx.orgId}::uuid ORDER BY a.created_at`;
}

export async function getAgent(ctx: MemberContext, id: string) {
  const [agent] = await db()`
    SELECT a.*, p.policy_key, p.active_version AS policy_version, (p.disabled_at IS NOT NULL) AS policy_disabled,
      u.address AS status_changed_by_address, cu.address AS created_by_address
    FROM agents a LEFT JOIN policies p ON p.id = a.policy_id LEFT JOIN users u ON u.id = a.status_changed_by
    LEFT JOIN users cu ON cu.id = a.created_by
    WHERE a.id = ${id}::uuid AND a.org_id = ${ctx.orgId}::uuid`;
  if (!agent) throw notFound("Agent");
  const credentials = await db()`
    SELECT c.id, c.label, c.prefix, c.created_at, c.last_used_at, c.revoked_at, u.address AS created_by
    FROM api_credentials c LEFT JOIN users u ON u.id = c.created_by
    WHERE c.agent_id = ${id}::uuid ORDER BY c.created_at DESC`;
  const [usage] = await db()`
    SELECT coalesce(sum(usd_micros) FILTER (WHERE ps_holds_budget(state, expires_at)), 0)::text AS reserved_usd_micros,
      count(*) FILTER (WHERE decision = 'ALLOW')::int AS allowed,
      count(*) FILTER (WHERE decision = 'DENY')::int AS denied,
      count(*) FILTER (WHERE decision = 'REQUIRES_HUMAN_SIGNATURE')::int AS reviewed
    FROM operations WHERE agent_id = ${id}::uuid AND created_at > now() - interval '1 hour'`;
  const { status_changed_by_address, created_by_address, status_changed_by: _drop, created_by: _c, ...rest } = agent;
  void _drop;
  void _c;
  return { ...rest, created_by: created_by_address, status_changed_by: status_changed_by_address, credentials, last_hour: usage };
}

async function checkPolicyBinding(ctx: MemberContext, policyId: string | null, chain: number, account: string) {
  if (policyId === null) return;
  const [p] = await db()`
    SELECT p.id, coalesce(pv.document->'account', p.draft->'account') AS account
    FROM policies p LEFT JOIN policy_versions pv ON pv.policy_id = p.id AND pv.version = p.active_version
    WHERE p.id = ${policyId}::uuid AND p.org_id = ${ctx.orgId}::uuid`;
  if (!p) throw notFound("Policy");
  const acct = p.account as { chain_id?: number; address?: string } | null;
  if (acct && (acct.chain_id !== chain || String(acct.address).toLowerCase() !== account.toLowerCase()))
    throw new BadRequest("The policy protects a different account or chain than this agent");
}

function optionalPolicyId(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)) throw new BadRequest("policy_id must be a policy's id");
  return v;
}

export async function createAgent(ctx: MemberContext, body: Record<string, unknown>) {
  const name = text(body.name, "name");
  const chain = chainId(body.chain_id);
  const account = parseAddress(body.account);
  const policyId = optionalPolicyId(body.policy_id);
  await checkPolicyBinding(ctx, policyId, chain, account);
  const a = audit("agent.created", { name, chain_id: chain, account, policy_id: policyId });
  const [row] = await db()`
    WITH ag AS (
      INSERT INTO agents (org_id, name, chain_id, account, policy_id, created_by)
      VALUES (${ctx.orgId}::uuid, ${name}, ${chain}::int, ${account}, ${policyId}::uuid, ${ctx.user.userId}::uuid) RETURNING id, org_id
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail)
      SELECT org_id, ${ctx.user.userId}::uuid, id, ${a.type}, ${a.detail}::text::jsonb FROM ag
    )
    SELECT id FROM ag`;
  return getAgent(ctx, row.id);
}

export async function updateAgent(ctx: MemberContext, id: string, body: Record<string, unknown>) {
  const [agent] = await db()`SELECT * FROM agents WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid`;
  if (!agent) throw notFound("Agent");
  if (agent.status === "revoked") throw conflict("A revoked agent cannot be changed");
  const name = body.name === undefined ? agent.name : text(body.name, "name");
  const policyId = body.policy_id === undefined ? agent.policy_id : optionalPolicyId(body.policy_id);
  await checkPolicyBinding(ctx, policyId, agent.chain_id, agent.account);
  const a = audit("agent.updated", { agent_id: id, name, policy_id: policyId });
  await db()`
    WITH ag AS (
      UPDATE agents SET name = ${name}, policy_id = ${policyId}::uuid WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid RETURNING id, org_id
    )
    INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail)
    SELECT org_id, ${ctx.user.userId}::uuid, id, ${a.type}, ${a.detail}::text::jsonb FROM ag`;
  return getAgent(ctx, id);
}

/**
 * Pause, resume or revoke. The database row is the enforcement point: every evaluation reads it,
 * and the atomic commit re-reads it, so the response reflects state that is already enforced.
 */
export async function setAgentStatus(ctx: MemberContext, id: string, to: "paused" | "active" | "revoked", body: Record<string, unknown>) {
  requireConfirm(body);
  const from = to === "active" ? ["paused"] : to === "paused" ? ["active"] : ["active", "paused"];
  const a = audit(`agent.${to === "active" ? "resumed" : to}`, { agent_id: id });
  const rows = await db()`
    WITH ag AS (
      UPDATE agents SET status = ${to}, status_changed_at = now(), status_changed_by = ${ctx.user.userId}::uuid
      WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid AND status = ANY(${from}::text[]) RETURNING id, org_id
    ), keys AS (
      UPDATE api_credentials SET revoked_at = now(), revoked_by = ${ctx.user.userId}::uuid
      WHERE agent_id IN (SELECT id FROM ag) AND ${to} = 'revoked' AND revoked_at IS NULL
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail)
      SELECT org_id, ${ctx.user.userId}::uuid, id, ${a.type}, ${a.detail}::text::jsonb FROM ag
    )
    SELECT id FROM ag`;
  if (rows.length === 0) throw conflict(`Agent not found, or it is not ${from.join(" or ")}`);
  return getAgent(ctx, id);
}

// ---------------------------------------------------------------- API credentials

/** Creates a key for an agent. The secret is returned once and only its SHA-256 is stored. */
export async function createCredential(ctx: MemberContext, agentId: string, body: Record<string, unknown>) {
  const label = body.label === undefined ? "API key" : text(body.label, "label");
  const secret = `ps_test_${randomHex(24)}`;
  const prefix = secret.slice(0, 16);
  const a = audit("credential.created", { agent_id: agentId, prefix, label });
  const rows = await db()`
    WITH ag AS (SELECT id, org_id FROM agents WHERE id = ${agentId}::uuid AND org_id = ${ctx.orgId}::uuid AND status <> 'revoked'),
    c AS (
      INSERT INTO api_credentials (org_id, agent_id, label, prefix, secret_hash, created_by)
      SELECT org_id, id, ${label}, ${prefix}, decode(${await sha256Hex(secret)}, 'hex'), ${ctx.user.userId}::uuid FROM ag
      RETURNING id, org_id, agent_id, created_at
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail)
      SELECT org_id, ${ctx.user.userId}::uuid, agent_id, ${a.type}, ${a.detail}::text::jsonb FROM c
    )
    SELECT id, created_at FROM c`;
  if (rows.length === 0) throw notFound("Active agent");
  return { id: rows[0].id, label, prefix, created_at: rows[0].created_at, secret, note: "Store this key now. It is not shown again." };
}

export async function revokeCredential(ctx: MemberContext, id: string) {
  const rows = await db()`
    WITH c AS (
      UPDATE api_credentials SET revoked_at = now(), revoked_by = ${ctx.user.userId}::uuid
      WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid AND revoked_at IS NULL RETURNING id, org_id, agent_id, prefix
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail)
      SELECT org_id, ${ctx.user.userId}::uuid, agent_id, 'credential.revoked', jsonb_build_object('credential_id', id, 'prefix', prefix) FROM c
    )
    SELECT id FROM c`;
  if (rows.length === 0) throw conflict("Key not found or already revoked");
  return { id, revoked: true };
}

// ---------------------------------------------------------------- audit

export async function listAudit(ctx: MemberContext, params: URLSearchParams) {
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 50) || 50, 1), 200);
  const before = params.get("before");
  const type = params.get("type");
  const agentId = params.get("agent_id");
  if (before !== null && !/^\d{1,18}$/.test(before)) throw new BadRequest("before must be a sequence number");
  if (type !== null && !/^[a-z_.]{1,64}$/.test(type)) throw new BadRequest("type is malformed");
  if (agentId !== null && !/^[0-9a-f-]{36}$/i.test(agentId)) throw new BadRequest("agent_id is malformed");
  const from = params.get("from");
  const to = params.get("to");
  for (const t of [from, to]) if (t !== null && Number.isNaN(Date.parse(t))) throw new BadRequest("from and to must be ISO timestamps");
  // Security events: denials, holds, pauses, revocations, stops and approval decisions.
  const security = params.get("kind") === "security";
  const rows = await db()`
    SELECT e.seq, e.event_id, e.type, e.detail, e.created_at, e.schema_version, u.address AS actor_address,
      e.actor_agent_id, a.name AS actor_agent_name
    FROM audit_events e LEFT JOIN users u ON u.id = e.actor_user_id LEFT JOIN agents a ON a.id = e.actor_agent_id
    WHERE e.org_id = ${ctx.orgId}::uuid
      AND (${before}::bigint IS NULL OR e.seq < ${before}::bigint)
      AND (${type}::text IS NULL OR e.type = ${type}::text OR e.type LIKE ${type ? `${type}.%` : null}::text)
      AND (${agentId}::uuid IS NULL OR e.actor_agent_id = ${agentId}::uuid)
      AND (${from}::timestamptz IS NULL OR e.created_at >= ${from}::timestamptz)
      AND (${to}::timestamptz IS NULL OR e.created_at < ${to}::timestamptz)
      AND (NOT ${security}::boolean OR e.type IN ('operation.denied', 'operation.pending_approval', 'operation.approved', 'operation.rejected',
        'agent.paused', 'agent.revoked', 'credential.revoked', 'policy.disabled', 'policy.activated', 'org.emergency_stop.activated', 'org.emergency_stop.lifted'))
    ORDER BY e.seq DESC LIMIT ${limit}::int`;
  const events = rows.map((r: Row) => ({ ...r, seq: String(r.seq) }));
  return { events, next_before: rows.length === limit ? String(rows[rows.length - 1]!.seq) : null };
}
