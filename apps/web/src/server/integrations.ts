import "server-only";
import type { AgentContext, MemberContext } from "./access";
import { db, type Row } from "./db";
import { BadRequest, HttpError } from "./http";
import { toDecision } from "./operations";

/*
 * Palisec Connect. An integration is a registered agent: its API keys are the integration's
 * credentials (scoped, revocable, rotatable). These views add activity and health; they never
 * change authorization.
 */

/** Console: every integration with credential status, scopes, activity, errors and webhook health. */
export async function listIntegrations(ctx: MemberContext) {
  const integrations = await db()`
    SELECT a.id, a.name, a.framework, a.description, a.chain_id, a.account, a.status, a.created_at,
      p.policy_key, p.active_version AS policy_version,
      coalesce((SELECT json_agg(json_build_object('id', c.id, 'label', c.label, 'prefix', c.prefix, 'scopes', c.scopes,
          'last_used_at', c.last_used_at, 'created_at', c.created_at) ORDER BY c.created_at DESC)
        FROM api_credentials c WHERE c.agent_id = a.id AND c.revoked_at IS NULL), '[]'::json) AS credentials,
      (SELECT max(c.last_used_at) FROM api_credentials c WHERE c.agent_id = a.id) AS last_activity_at,
      (SELECT count(*) FROM operations o WHERE o.agent_id = a.id AND o.created_at > now() - interval '24 hours')::int AS requests_24h,
      (SELECT count(*) FROM operations o WHERE o.agent_id = a.id AND o.decision = 'DENY' AND o.created_at > now() - interval '24 hours')::int AS denied_24h
    FROM agents a LEFT JOIN policies p ON p.id = a.policy_id
    WHERE a.org_id = ${ctx.orgId}::uuid ORDER BY a.created_at`;
  const [webhooks] = await db()`
    SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'disabled')::int AS disabled,
      coalesce(sum(consecutive_failures), 0)::int AS failing
    FROM webhooks WHERE org_id = ${ctx.orgId}::uuid`;
  return { integrations, webhooks };
}

// ---------------------------------------------------------------- what an API key can read about itself

/** `GET /v1/integration`: the authenticated integration, its scopes and protected account. */
export async function whoAmI(agent: AgentContext) {
  const [row] = await db()`
    SELECT a.name, a.framework, a.status, p.policy_key, p.active_version AS policy_version
    FROM agents a LEFT JOIN policies p ON p.id = a.policy_id WHERE a.id = ${agent.agentId}::uuid`;
  return {
    agent_id: agent.agentId,
    name: row?.name,
    framework: row?.framework ?? null,
    status: row?.status,
    chain_id: agent.chainId,
    account: agent.account,
    scopes: agent.scopes,
    policy: row?.policy_key ? { policy_key: row.policy_key, version: row.policy_version } : null,
    emergency_stop: agent.emergencyStop,
  };
}

/** `GET /v1/integration/policy`: the exact active policy version this agent is evaluated against. */
export async function boundPolicy(agent: AgentContext) {
  if (!agent.policyId) throw new HttpError(404, "PS_POLICY_001", "No policy is bound to this agent");
  const [row] = await db()`
    SELECT p.id, p.policy_key, p.name, p.active_version AS version, pv.document, pv.document_hash, pv.activated_at,
      (p.disabled_at IS NOT NULL) AS disabled
    FROM policies p LEFT JOIN policy_versions pv ON pv.policy_id = p.id AND pv.version = p.active_version
    WHERE p.id = ${agent.policyId}::uuid AND p.org_id = ${agent.orgId}::uuid`;
  if (!row || row.version === null) throw new HttpError(404, "PS_POLICY_001", "The bound policy has no active version");
  return row;
}

function pageParams(params: URLSearchParams) {
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 20) || 20, 1), 100);
  const before = params.get("before");
  if (before !== null && Number.isNaN(Date.parse(before))) throw new BadRequest("before must be an ISO timestamp");
  return { limit, before };
}

/** `GET /v1/integration/operations`: this agent's own operations, newest first. */
export async function ownOperations(agent: AgentContext, params: URLSearchParams) {
  const { limit, before } = pageParams(params);
  const decision = params.get("decision");
  if (decision !== null && !["ALLOW", "DENY", "REQUIRES_HUMAN_SIGNATURE"].includes(decision)) throw new BadRequest("decision is not valid");
  const rows = await db()`
    SELECT o.*, a.name AS agent_name, p.policy_key FROM operations o JOIN agents a ON a.id = o.agent_id LEFT JOIN policies p ON p.id = o.policy_id
    WHERE o.agent_id = ${agent.agentId}::uuid AND o.org_id = ${agent.orgId}::uuid
      AND (${before}::timestamptz IS NULL OR o.created_at < ${before}::timestamptz)
      AND (${decision}::text IS NULL OR o.decision = ${decision}::text)
    ORDER BY o.created_at DESC LIMIT ${limit}::int`;
  const operations = rows.map((r: Row) => {
    const d = toDecision(r);
    return { ...d, details: { ...d.details, calldata: undefined } };
  });
  return { operations, next_before: rows.length === limit ? new Date(rows[rows.length - 1]!.created_at).toISOString() : null };
}

/** `GET /v1/integration/audit-events`: audit events this agent caused or that concern it. */
export async function ownAuditEvents(agent: AgentContext, params: URLSearchParams) {
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 50) || 50, 1), 200);
  const before = params.get("before");
  if (before !== null && !/^\d{1,18}$/.test(before)) throw new BadRequest("before must be a sequence number");
  const rows = await db()`
    SELECT e.seq, e.event_id, e.type, e.detail, e.created_at FROM audit_events e
    WHERE e.org_id = ${agent.orgId}::uuid AND e.actor_agent_id = ${agent.agentId}::uuid
      AND (${before}::bigint IS NULL OR e.seq < ${before}::bigint)
    ORDER BY e.seq DESC LIMIT ${limit}::int`;
  return { events: rows.map((r: Row) => ({ ...r, seq: String(r.seq) })), next_before: rows.length === limit ? String(rows[rows.length - 1]!.seq) : null };
}
