import "server-only";
import type { MemberContext } from "./access";
import { db } from "./db";
import { BadRequest, HttpError } from "./http";
import { policyChanges } from "./diff";

/** API usage from the ledger: requests and outcomes per agent and per key, 24 hours and 7 days, plus a daily series. */
export async function usage(ctx: MemberContext) {
  const [keys, daily, totals] = await Promise.all([
    db()`
      SELECT c.id, c.label, c.prefix, c.scopes, c.created_at, c.last_used_at, c.revoked_at, a.id AS agent_id, a.name AS agent_name,
        count(o.id) FILTER (WHERE o.created_at > now() - interval '24 hours')::int AS requests_24h,
        count(o.id)::int AS requests_7d,
        count(o.id) FILTER (WHERE o.decision = 'ALLOW')::int AS allowed_7d,
        count(o.id) FILTER (WHERE o.decision = 'DENY')::int AS denied_7d,
        count(o.id) FILTER (WHERE o.decision = 'REQUIRES_HUMAN_SIGNATURE')::int AS reviewed_7d
      FROM api_credentials c JOIN agents a ON a.id = c.agent_id
      LEFT JOIN operations o ON o.credential_id = c.id AND o.created_at > now() - interval '7 days'
      WHERE c.org_id = ${ctx.orgId}::uuid
      GROUP BY c.id, a.id ORDER BY requests_7d DESC, c.created_at DESC`,
    db()`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
        count(*) FILTER (WHERE decision = 'ALLOW')::int AS allowed,
        count(*) FILTER (WHERE decision = 'DENY')::int AS denied,
        count(*) FILTER (WHERE decision = 'REQUIRES_HUMAN_SIGNATURE')::int AS reviewed
      FROM operations WHERE org_id = ${ctx.orgId}::uuid AND created_at > now() - interval '7 days'
      GROUP BY 1 ORDER BY 1`,
    db()`
      SELECT (SELECT count(*) FROM agent_tool_calls WHERE org_id = ${ctx.orgId}::uuid AND created_at > now() - interval '7 days')::int AS agent_tool_calls_7d,
        (SELECT count(*) FROM webhook_deliveries WHERE org_id = ${ctx.orgId}::uuid AND created_at > now() - interval '7 days')::int AS webhook_deliveries_7d`,
  ]);
  return { window: "7d", timezone: "UTC", keys, daily, ...totals[0] };
}

/** Changes between two versions of a policy, or between a version and the current draft (`to` omitted). */
export async function comparePolicy(ctx: MemberContext, id: string, params: URLSearchParams) {
  const from = Number(params.get("from"));
  const toRaw = params.get("to");
  const to = toRaw === null || toRaw === "draft" ? null : Number(toRaw);
  if (!Number.isInteger(from) || from < 1 || (to !== null && (!Number.isInteger(to) || to < 1))) throw new BadRequest("from (and optional to) must be version numbers");
  const rows = await db()`
    SELECT v.version, v.document, p.draft FROM policies p LEFT JOIN policy_versions v ON v.policy_id = p.id
    WHERE p.id = ${id}::uuid AND p.org_id = ${ctx.orgId}::uuid`;
  if (!rows.length) throw new HttpError(404, "PS_REQUEST_001", "Policy not found in this organization");
  const a = rows.find((r) => r.version === from)?.document;
  const b = to === null ? rows[0]!.draft : rows.find((r) => r.version === to)?.document;
  if (!a || !b) throw new HttpError(404, "PS_REQUEST_001", "Version not found");
  return { from, to: to ?? "draft", changes: policyChanges(a, b) };
}
