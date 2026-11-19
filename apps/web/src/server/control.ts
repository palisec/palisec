import "server-only";
import { classifyPolicyChange, SCHEMA_VERSION, summarizeChanges, validatePolicy, type Policy, type ValidationError } from "@palisec/policy-schema";
import { DEFAULT_SCOPES, SCOPES, type MemberContext, type Scope } from "./access";
import { planLimitError, planLimits, refreshPro } from "./billing";
import { chainEnabled, enabledChainIds } from "./config";
import { MAINNET } from "@/lib/networks";
import { db, type Row } from "./db";
import { BadRequest, HttpError } from "./http";
import type { Role } from "./session";
import { parseAddress } from "./siwe";
import { canonicalJson, randomHex, sha256Hex } from "./tokens";
import { announcePending, classifyRebind, listPending, orgDelays, parseDelaySetting, requestPending } from "./pending";


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

function optionalText(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null || v === "") return null;
  return text(v, field, max);
}

function chainId(v: unknown): number {
  if (typeof v !== "number" || !chainEnabled(v)) throw new BadRequest(`chain_id must be an enabled network: ${enabledChainIds().join(", ")}`);
  return v;
}

/** Keys say which money they touch: ps_live_ for a mainnet agent, ps_test_ for testnet (as Stripe does). */
const keyPrefixFor = (chain: number) => (chain === MAINNET ? "ps_live_" : "ps_test_");
async function agentChain(orgId: string, where: { agentId?: string; credentialId?: string }): Promise<number | null> {
  const rows = where.agentId
    ? await db()`SELECT chain_id FROM agents WHERE id = ${where.agentId}::uuid AND org_id = ${orgId}::uuid`
    : await db()`SELECT a.chain_id FROM api_credentials c JOIN agents a ON a.id = c.agent_id WHERE c.id = ${where.credentialId!}::uuid AND c.org_id = ${orgId}::uuid`;
  return rows[0] ? Number(rows[0].chain_id) : null;
}

function requireConfirm(body: Record<string, unknown>) {
  if (body.confirm !== true) throw new BadRequest('This action needs explicit confirmation: send "confirm": true');
}

const audit = (type: string, detail: Record<string, unknown>) => ({ type, detail: JSON.stringify(detail) });

// ---------------------------------------------------------------- organization

export async function getOrganization(ctx: MemberContext) {
  const [o] = await db()`
    SELECT o.id, o.name, o.emergency_stop, o.created_at, o.loosening_delay_seconds, o.stop_lift_delay_seconds,
      (SELECT count(*) FROM agents WHERE org_id = o.id AND status <> 'revoked')::int AS agents,
      (SELECT count(*) FROM policies WHERE org_id = o.id)::int AS policies,
      (SELECT count(*) FROM memberships WHERE org_id = o.id)::int AS members
    FROM organizations o WHERE o.id = ${ctx.orgId}::uuid`;
  return { ...o, role: ctx.role, pending_changes: await listPending(ctx.orgId) };
}

/**
 * Phase 6 delay settings (owner). Raising a delay applies now; lowering one is itself a loosening and
 * waits out the current loosening delay. A raise also cancels any pending lowering, which could
 * otherwise overtake it later.
 */
export async function setDelays(ctx: MemberContext, body: Record<string, unknown>) {
  requireConfirm(body);
  if (ctx.role !== "owner") throw new HttpError(403, "PS_AUTH_001", "Only an owner can change the delays");
  const current = await orgDelays(ctx.orgId);
  const next = parseDelaySetting(body, current);
  if (next.diff.length === 0) return getOrganization(ctx);
  if (next.diff.some((d) => d.kind === "loosening")) {
    const setting = { loosening_delay_seconds: next.loosening, stop_lift_delay_seconds: next.lift };
    await requestPending(ctx, "delay_change", { setting, diff: next.diff, delaySeconds: current.loosening });
    return getOrganization(ctx);
  }
  const a = audit("org.delays_changed", { loosening_delay_seconds: next.loosening, stop_lift_delay_seconds: next.lift, diff: next.diff });
  await db()`
    WITH u AS (
      UPDATE organizations SET loosening_delay_seconds = ${next.loosening}::int, stop_lift_delay_seconds = ${next.lift}::int
      WHERE id = ${ctx.orgId}::uuid RETURNING id
    ), c AS (
      UPDATE pending_changes SET state = 'cancelled', resolved_at = now(), resolved_by = ${ctx.user.userId}::uuid, resolution = 'superseded'
      WHERE org_id IN (SELECT id FROM u) AND state = 'pending' AND kind = 'delay_change' RETURNING id
    ), ce AS (
      INSERT INTO audit_events (org_id, actor_user_id, type, detail)
      SELECT ${ctx.orgId}::uuid, ${ctx.user.userId}::uuid, 'policy.loosening_cancelled',
        jsonb_build_object('pending_change_id', id, 'kind', 'delay_change', 'reason', 'superseded') FROM c
    )
    INSERT INTO audit_events (org_id, actor_user_id, type, detail) SELECT id, ${ctx.user.userId}::uuid, ${a.type}, ${a.detail}::text::jsonb FROM u`;
  return getOrganization(ctx);
}

export async function renameOrganization(ctx: MemberContext, body: Record<string, unknown>) {
  const name = text(body.name, "name");
  const a = audit("org.renamed", { name });
  await db()`
    WITH u AS (UPDATE organizations SET name = ${name} WHERE id = ${ctx.orgId}::uuid RETURNING id)
    INSERT INTO audit_events (org_id, actor_user_id, type, detail) SELECT id, ${ctx.user.userId}::uuid, ${a.type}, ${a.detail}::text::jsonb FROM u`;
  return getOrganization(ctx);
}

/**
 * Turning the stop on is an operator action and is instant; it also cancels a pending lift. Turning it
 * off needs the owner (spec §11.8) and, since Phase 6, waits out the organization's lift delay.
 */
export async function setEmergencyStop(ctx: MemberContext, body: Record<string, unknown>) {
  requireConfirm(body);
  if (typeof body.active !== "boolean") throw new BadRequest("active must be true or false");
  if (!body.active && ctx.role !== "owner") throw new HttpError(403, "PS_AUTH_001", "Only an owner can lift the emergency stop");
  if (body.active) {
    const a = audit("org.emergency_stop.activated", {});
    await db()`
      WITH u AS (UPDATE organizations SET emergency_stop = true WHERE id = ${ctx.orgId}::uuid AND emergency_stop = false RETURNING id),
      c AS (
        UPDATE pending_changes SET state = 'cancelled', resolved_at = now(), resolved_by = ${ctx.user.userId}::uuid, resolution = 'stop_engaged'
        WHERE org_id = ${ctx.orgId}::uuid AND state = 'pending' AND kind = 'emergency_lift' RETURNING id
      ), ce AS (
        INSERT INTO audit_events (org_id, actor_user_id, type, detail)
        SELECT ${ctx.orgId}::uuid, ${ctx.user.userId}::uuid, 'policy.loosening_cancelled',
          jsonb_build_object('pending_change_id', id, 'kind', 'emergency_lift', 'reason', 'stop_engaged') FROM c
      )
      INSERT INTO audit_events (org_id, actor_user_id, type, detail) SELECT id, ${ctx.user.userId}::uuid, ${a.type}, ${a.detail}::text::jsonb FROM u`;
    return getOrganization(ctx);
  }
  const [o] = await db()`SELECT emergency_stop, stop_lift_delay_seconds FROM organizations WHERE id = ${ctx.orgId}::uuid`;
  if (!o?.emergency_stop) return getOrganization(ctx);
  await requestPending(ctx, "emergency_lift", {
    diff: [{ path: "$.emergency_stop", kind: "loosening", from: true, to: false, note: "emergency stop lifted" }],
    delaySeconds: Number(o.stop_lift_delay_seconds),
  });
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
    // Phase 6: on by default for new policies (existing ones keep it off until the owner adds it).
    asset_safety: { ...DEFAULT_ASSET_SAFETY },
  };
}

/** Defaults for schema 1.1 asset safety (Phase 6 brief): 5% tax, sell leg required, no unlimited approvals, deny without a simulation. */
export const DEFAULT_ASSET_SAFETY = {
  enabled: true,
  max_transfer_tax_bps: 500,
  max_slippage_bps: 300,
  require_sell_simulation: true,
  block_unlimited_approvals: true,
  on_simulation_unavailable: "deny",
  max_simulation_age_seconds: 10,
} as const;

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
  const pending = (await listPending(ctx.orgId, { policyId: id })).find((c) => c.kind === "policy_activation") ?? null;
  return {
    pending,
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
  // Plan limit (Phase 5): counted on creation only; existing policies are never removed.
  await refreshPro(ctx.orgId).catch(() => {});
  const plan = await planLimits(ctx.orgId);
  const [{ n: policyCount }] = await db()`SELECT count(*)::int AS n FROM policies WHERE org_id = ${ctx.orgId}::uuid AND disabled_at IS NULL`;
  if (policyCount >= plan.limits.policies) throw planLimitError("active policies", plan.limits.policies);
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
 *
 * Phase 6: the draft is classified against the version that decides today. If anything loosens and
 * an agent depends on this policy, the version waits as `pending_activation` for the organization's
 * delay while the current version keeps deciding. A change that only tightens applies at once (and
 * supersedes any pending version). A policy no agent uses decides nothing, so it activates at once.
 */
export async function activatePolicy(ctx: MemberContext, id: string, body: Record<string, unknown>) {
  requireConfirm(body);
  const current = await getPolicy(ctx, id);
  if (!current.draft) throw conflict("There is no draft to activate");
  if (body.draft_hash !== current.draft_hash) throw conflict("The draft changed since you reviewed it. Reload and review it again.");
  if (current.draft_errors.length) throw new HttpError(422, "PS_POLICY_001", `Draft is invalid: ${current.draft_errors[0]!.path} ${current.draft_errors[0]!.message}`);
  const [{ next, bound }] = await db()`
    SELECT coalesce((SELECT max(version) FROM policy_versions WHERE policy_id = ${id}::uuid), 0) + 1 AS next,
      -- Agents bound to it, or waiting to be moved onto it: both depend on what it allows.
      ((SELECT count(*) FROM agents WHERE policy_id = ${id}::uuid AND status <> 'revoked') +
       (SELECT count(*) FROM pending_changes WHERE org_id = ${ctx.orgId}::uuid AND state = 'pending' AND kind = 'agent_rebind'
          AND setting->>'policy_id' = ${id}::text))::int AS bound`;
  const document = { ...(current.draft as object), version: Number(next), status: "active" } as Policy;
  const hash = await sha256Hex(canonicalJson(document));
  const before = (current.active_document as Policy | null) ?? null;
  const cls = classifyPolicyChange(before, document, { disabled: current.status === "disabled" });
  const delay = cls.loosening && bound > 0;
  const summary = summarizeChanges(cls.changes);
  let r: Record<string, unknown>;
  try {
    [{ r }] = await db()`
      SELECT ps_activate_policy(${id}::uuid, ${ctx.orgId}::uuid, ${ctx.user.userId}::uuid, ${current.active_version}::int,
        ${JSON.stringify(current.draft)}::text::jsonb, ${Number(next)}::int, ${JSON.stringify(document)}::text::jsonb, ${hash},
        ${delay}, ${JSON.stringify(cls.changes)}::text::jsonb, ${summary}) AS r`;
  } catch (e) {
    // Two activations racing for the same version number: one wins, the other is told to reload.
    if ((e as { code?: string }).code === "23505") throw conflict("The policy changed while activating. Reload and try again.");
    throw e;
  }
  if (r.outcome === "conflict") throw conflict("The policy changed while activating. Reload and try again.");
  const effectiveAt = r.effective_at ? new Date(String(r.effective_at)).toISOString() : null;
  if (r.outcome === "pending")
    announcePending(ctx.orgId, {
      pending_change_id: r.pending_change_id,
      kind: "policy_activation",
      policy_id: id,
      policy_key: current.policy_key,
      policy_version: Number(next),
      summary,
      diff: cls.changes,
      effective_at: effectiveAt,
    });
  const after = await getPolicy(ctx, id);
  return {
    ...after,
    state: r.outcome === "pending" ? "pending_activation" : "active",
    effective_at: effectiveAt,
    activated_version: Number(next),
    changes: cls.changes,
  };
}

export async function disablePolicy(ctx: MemberContext, id: string, body: Record<string, unknown>) {
  requireConfirm(body);
  const a = audit("policy.disabled", { policy_id: id });
  const rows = await db()`
    WITH p AS (
      UPDATE policies SET disabled_at = now() WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid AND disabled_at IS NULL RETURNING id, org_id
    ), c AS (
      -- Disabling tightens at once; a pending activation would otherwise re-enable the policy later.
      UPDATE pending_changes SET state = 'cancelled', resolved_at = now(), resolved_by = ${ctx.user.userId}::uuid, resolution = 'policy_disabled'
      WHERE policy_id IN (SELECT id FROM p) AND state = 'pending' AND kind = 'policy_activation' RETURNING id
    ), ce AS (
      INSERT INTO audit_events (org_id, actor_user_id, type, detail)
      SELECT ${ctx.orgId}::uuid, ${ctx.user.userId}::uuid, 'policy.loosening_cancelled',
        jsonb_build_object('pending_change_id', id, 'kind', 'policy_activation', 'policy_id', ${id}::uuid, 'reason', 'policy_disabled') FROM c
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
    SELECT a.id, a.name, a.framework, a.description, a.chain_id, a.account, a.status, a.status_changed_at, a.created_at,
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
    SELECT c.id, c.label, c.prefix, c.scopes, c.rotated_from, c.created_at, c.last_used_at, c.revoked_at, u.address AS created_by
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
  const framework = optionalText(body.framework, "framework", 40);
  const description = optionalText(body.description, "description", 280);
  await refreshPro(ctx.orgId).catch(() => {});
  const plan = await planLimits(ctx.orgId);
  const [{ n: agentCount }] = await db()`SELECT count(*)::int AS n FROM agents WHERE org_id = ${ctx.orgId}::uuid AND status <> 'revoked'`;
  if (agentCount >= plan.limits.agents) throw planLimitError("agents", plan.limits.agents);
  await checkPolicyBinding(ctx, policyId, chain, account);
  // Phase 6: a second agent on an account that PALISEC already protects would be a way around the
  // delay (its policy could be looser), so it starts paused and resumes after the loosening delay.
  const guarded = policyId !== null && (await accountProtected(ctx.orgId, chain, account, null));
  const a = audit("agent.created", { name, chain_id: chain, account, policy_id: policyId, framework, starts_paused: guarded });
  const [row] = await db()`
    WITH ag AS (
      INSERT INTO agents (org_id, name, chain_id, account, policy_id, framework, description, created_by, status)
      VALUES (${ctx.orgId}::uuid, ${name}, ${chain}::int, ${account}, ${policyId}::uuid, ${framework}, ${description}, ${ctx.user.userId}::uuid,
        ${guarded ? "paused" : "active"}) RETURNING id, org_id
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail)
      SELECT org_id, ${ctx.user.userId}::uuid, id, ${a.type}, ${a.detail}::text::jsonb FROM ag
    )
    SELECT id FROM ag`;
  if (guarded) {
    const delays = await orgDelays(ctx.orgId);
    await requestPending(ctx, "agent_resume", {
      agentId: row.id,
      diff: [{ path: "$.agents", kind: "loosening", from: null, to: { agent_id: row.id, policy_id: policyId }, note: "another agent added on an account PALISEC already protects" }],
      delaySeconds: delays.loosening,
    });
  }
  return getAgent(ctx, row.id);
}

/** Whether another non-revoked agent of the organization already has an active policy on this account. */
async function accountProtected(orgId: string, chain: number, account: string, exceptAgent: string | null): Promise<boolean> {
  const [r] = await db()`
    SELECT EXISTS (
      SELECT 1 FROM agents a JOIN policies p ON p.id = a.policy_id
      WHERE a.org_id = ${orgId}::uuid AND a.chain_id = ${chain}::int AND lower(a.account) = lower(${account}) AND a.status <> 'revoked'
        AND p.active_version IS NOT NULL AND p.disabled_at IS NULL AND (${exceptAgent}::uuid IS NULL OR a.id <> ${exceptAgent}::uuid)
    ) AS protected`;
  return Boolean(r?.protected);
}

export async function updateAgent(ctx: MemberContext, id: string, body: Record<string, unknown>) {
  const [agent] = await db()`SELECT * FROM agents WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid`;
  if (!agent) throw notFound("Agent");
  if (agent.status === "revoked") throw conflict("A revoked agent cannot be changed");
  const name = body.name === undefined ? agent.name : text(body.name, "name");
  const policyId = body.policy_id === undefined ? agent.policy_id : optionalPolicyId(body.policy_id);
  const framework = body.framework === undefined ? agent.framework : optionalText(body.framework, "framework", 40);
  const description = body.description === undefined ? agent.description : optionalText(body.description, "description", 280);
  await checkPolicyBinding(ctx, policyId, agent.chain_id, agent.account);
  // Phase 6: moving the agent to a looser policy waits out the delay; everything else applies now.
  let boundPolicy = policyId;
  let pendingRebind: Awaited<ReturnType<typeof requestPending>> | null = null;
  if (policyId !== agent.policy_id) {
    const cls = await classifyRebind(ctx.orgId, agent.policy_id, policyId);
    const fresh = agent.policy_id === null && !(await accountProtected(ctx.orgId, agent.chain_id, agent.account, id));
    if (cls.loosening && !fresh) {
      boundPolicy = agent.policy_id;
      const delays = await orgDelays(ctx.orgId);
      pendingRebind = await requestPending(ctx, "agent_rebind", { agentId: id, setting: { policy_id: policyId }, diff: cls.changes, delaySeconds: delays.loosening });
    }
  }
  const a = audit("agent.updated", { agent_id: id, name, policy_id: boundPolicy, framework, ...(pendingRebind ? { pending_policy_id: policyId } : {}) });
  await db()`
    WITH ag AS (
      UPDATE agents SET name = ${name}, policy_id = ${boundPolicy}::uuid, framework = ${framework}, description = ${description} WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid RETURNING id, org_id
    ), c AS (
      -- An applied (tightening) move supersedes a pending one, which could otherwise overtake it later.
      UPDATE pending_changes SET state = 'cancelled', resolved_at = now(), resolved_by = ${ctx.user.userId}::uuid, resolution = 'superseded'
      WHERE agent_id IN (SELECT id FROM ag) AND state = 'pending' AND kind = 'agent_rebind'
        AND ${pendingRebind === null && boundPolicy !== agent.policy_id}::boolean RETURNING id
    ), ce AS (
      INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail)
      SELECT ${ctx.orgId}::uuid, ${ctx.user.userId}::uuid, ${id}::uuid, 'policy.loosening_cancelled',
        jsonb_build_object('pending_change_id', id, 'kind', 'agent_rebind', 'reason', 'superseded') FROM c
    )
    INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail)
    SELECT org_id, ${ctx.user.userId}::uuid, id, ${a.type}, ${a.detail}::text::jsonb FROM ag`;
  const out = await getAgent(ctx, id);
  return pendingRebind ? { ...out, pending_change: { kind: "agent_rebind", policy_id: policyId, ...pendingRebind } } : out;
}

/**
 * Pause, resume or revoke. The database row is the enforcement point: every evaluation reads it,
 * and the atomic commit re-reads it, so the response reflects state that is already enforced.
 */
export async function setAgentStatus(ctx: MemberContext, id: string, to: "paused" | "active" | "revoked", body: Record<string, unknown>) {
  requireConfirm(body);
  if (to === "active") {
    // Phase 6: resuming is a loosening and waits out the delay; pausing and revoking are instant.
    const [ag] = await db()`SELECT status FROM agents WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid`;
    if (!ag || ag.status !== "paused") throw conflict("Agent not found, or it is not paused");
    const delays = await orgDelays(ctx.orgId);
    const p = await requestPending(ctx, "agent_resume", {
      agentId: id,
      diff: [{ path: "$.status", kind: "loosening", from: "paused", to: "active", note: "agent resumed" }],
      delaySeconds: delays.loosening,
    });
    return { ...(await getAgent(ctx, id)), pending_change: { kind: "agent_resume", ...p } };
  }
  const from = to === "paused" ? ["active"] : ["active", "paused"];
  const a = audit(`agent.${to}`, { agent_id: id });
  const rows = await db()`
    WITH ag AS (
      UPDATE agents SET status = ${to}, status_changed_at = now(), status_changed_by = ${ctx.user.userId}::uuid
      WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid AND status = ANY(${from}::text[]) RETURNING id, org_id
    ), keys AS (
      UPDATE api_credentials SET revoked_at = now(), revoked_by = ${ctx.user.userId}::uuid
      WHERE agent_id IN (SELECT id FROM ag) AND ${to} = 'revoked' AND revoked_at IS NULL
    ), c AS (
      -- Pausing or revoking cancels a pending resume (and, on revoke, a pending move).
      UPDATE pending_changes SET state = 'cancelled', resolved_at = now(), resolved_by = ${ctx.user.userId}::uuid, resolution = ${`agent_${to}`}
      WHERE agent_id IN (SELECT id FROM ag) AND state = 'pending' AND (kind = 'agent_resume' OR ${to} = 'revoked') RETURNING id, kind
    ), ce AS (
      INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail)
      SELECT ${ctx.orgId}::uuid, ${ctx.user.userId}::uuid, ${id}::uuid, 'policy.loosening_cancelled',
        jsonb_build_object('pending_change_id', id, 'kind', kind, 'reason', ${`agent_${to}`}::text) FROM c
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
  const scopes = parseScopes(body.scopes);
  const chain = await agentChain(ctx.orgId, { agentId });
  if (chain === null) throw notFound("Active agent");
  const secret = `${keyPrefixFor(chain)}${randomHex(24)}`;
  const prefix = secret.slice(0, 16);
  const a = audit("credential.created", { agent_id: agentId, prefix, label, scopes });
  const rows = await db()`
    WITH ag AS (SELECT id, org_id FROM agents WHERE id = ${agentId}::uuid AND org_id = ${ctx.orgId}::uuid AND status <> 'revoked'),
    c AS (
      INSERT INTO api_credentials (org_id, agent_id, label, prefix, secret_hash, scopes, created_by)
      SELECT org_id, id, ${label}, ${prefix}, decode(${await sha256Hex(secret)}, 'hex'), ${scopes}::text[], ${ctx.user.userId}::uuid FROM ag
      RETURNING id, org_id, agent_id, created_at
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail)
      SELECT org_id, ${ctx.user.userId}::uuid, agent_id, ${a.type}, ${a.detail}::text::jsonb FROM c
    )
    SELECT id, created_at FROM c`;
  if (rows.length === 0) throw notFound("Active agent");
  return { id: rows[0].id, label, prefix, scopes, created_at: rows[0].created_at, secret, note: "Store this key now. It is not shown again." };
}

/** Scopes for a new key: a subset of SCOPES, defaulting to DEFAULT_SCOPES. */
function parseScopes(v: unknown): Scope[] {
  if (v === undefined) return [...DEFAULT_SCOPES];
  if (!Array.isArray(v) || v.length === 0) throw new BadRequest(`scopes must be a non-empty array of: ${SCOPES.join(", ")}`);
  for (const s of v) if (!(SCOPES as readonly unknown[]).includes(s)) throw new BadRequest(`Unknown scope: ${String(s).slice(0, 40)}`);
  return [...new Set(v as Scope[])];
}

/**
 * Replaces a key: a new secret with the same agent, label and scopes, and the old key revoked, in one
 * statement, so there is never a moment with both or neither. The new secret is returned once.
 */
export async function rotateCredential(ctx: MemberContext, id: string) {
  const chain = await agentChain(ctx.orgId, { credentialId: id });
  const secret = `${keyPrefixFor(chain ?? 0)}${randomHex(24)}`;
  const prefix = secret.slice(0, 16);
  const rows = await db()`
    WITH old AS (
      UPDATE api_credentials SET revoked_at = now(), revoked_by = ${ctx.user.userId}::uuid
      WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid AND revoked_at IS NULL
        AND agent_id IN (SELECT id FROM agents WHERE status <> 'revoked')
      RETURNING id, org_id, agent_id, label, scopes, prefix
    ), n AS (
      INSERT INTO api_credentials (org_id, agent_id, label, prefix, secret_hash, scopes, rotated_from, created_by)
      SELECT org_id, agent_id, label, ${prefix}, decode(${await sha256Hex(secret)}, 'hex'), scopes, id, ${ctx.user.userId}::uuid FROM old
      RETURNING id, org_id, agent_id, label, scopes, created_at
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail)
      SELECT n.org_id, ${ctx.user.userId}::uuid, n.agent_id, 'credential.rotated',
        jsonb_build_object('old_credential_id', old.id, 'old_prefix', old.prefix, 'credential_id', n.id, 'prefix', ${prefix}::text)
      FROM n JOIN old ON old.agent_id = n.agent_id
    )
    SELECT id, agent_id, label, scopes, created_at FROM n`;
  if (rows.length === 0) throw conflict("Key not found, already revoked, or its agent is revoked");
  const r = rows[0]!;
  return { id: r.id, agent_id: r.agent_id, label: r.label, prefix, scopes: r.scopes, created_at: r.created_at, rotated_from: id, secret, note: "Store this key now. It is not shown again. The old key no longer works." };
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
  // Audit history shown per plan (Phase 5): 90 days, or a year with Pro. Nothing is deleted.
  const { limits } = await planLimits(ctx.orgId);
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
      AND e.created_at > now() - make_interval(days => ${limits.auditDays}::int)
      AND (NOT ${security}::boolean OR e.type IN ('operation.denied', 'operation.pending_approval', 'operation.approved', 'operation.rejected',
        'agent.paused', 'agent.revoked', 'credential.revoked', 'policy.disabled', 'policy.activated', 'org.emergency_stop.activated', 'org.emergency_stop.lifted'))
    ORDER BY e.seq DESC LIMIT ${limit}::int`;
  const events = rows.map((r: Row) => ({ ...r, seq: String(r.seq) }));
  return { events, next_before: rows.length === limit ? String(rows[rows.length - 1]!.seq) : null };
}
