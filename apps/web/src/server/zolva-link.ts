import "server-only";
import type { Policy } from "@palisec/policy-schema";
import type { MemberContext } from "./access";
import { db } from "./db";
import { HttpError } from "./http";
import { agentRow, parseZolvaId, zolvaRecord, zolvaView } from "./zolva";
import { replayPolicy } from "./zolva-replay";

/**
 * Zolva: link or unlink an agent's Zolva agent (owner or admin). Audited. Linking is display only and
 * applies at once; it always locks the agent back to its policy's own limits (and cancels a pending
 * unlock), because bigger limits must be earned again, after the delay, for the new link.
 */
export async function setZolvaLink(ctx: MemberContext, agentId: string, raw: unknown) {
  const zid = parseZolvaId(raw);
  const agent = await agentRow(ctx.orgId, agentId);
  if (!agent) throw new HttpError(404, "PS_REQUEST_001", "Agent not found");
  if (agent.status === "revoked") throw new HttpError(409, "PS_REQUEST_001", "A revoked agent cannot be changed");
  if (zid) {
    const c = await zolvaRecord(zid, { timeoutMs: 5000 });
    if (c.error === "zolva_not_found" && !c.record) throw new HttpError(422, "PS_REQUEST_001", "No published Zolva agent with this ID.");
  }
  const detail = JSON.stringify({ agent_id: agentId, from: agent.zolva_agent_id ?? null, to: zid });
  try {
    await db()`
      WITH a AS (
        UPDATE agents SET zolva_agent_id = ${zid}, zolva_declared_id = NULL, zolva_declared_read_at = NULL, proven_unlocked_at = NULL
        WHERE id = ${agentId}::uuid AND org_id = ${ctx.orgId}::uuid RETURNING id, org_id
      ), p AS (
        UPDATE pending_changes SET state = 'cancelled', resolved_at = now(), resolved_by = ${ctx.user.userId}::uuid, resolution = 'Zolva link changed'
        WHERE agent_id = ${agentId}::uuid AND kind = 'proven_unlock' AND state = 'pending' RETURNING id
      )
      INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail)
      SELECT org_id, ${ctx.user.userId}::uuid, id, ${zid ? "agent.zolva_linked" : "agent.zolva_unlinked"}, ${detail}::text::jsonb FROM a`;
  } catch (e) {
    if (String((e as Error).message).includes("agents_zolva_once_per_org"))
      throw new HttpError(409, "PS_REQUEST_001", "Another agent in this organization is already linked to this Zolva agent.");
    throw e;
  }
  return zolvaView((await agentRow(ctx.orgId, agentId))!);
}

/** Replays the agent's policy (active, or its draft) against a Zolva agent's recorded trades. Read only. */
export async function replayForAgent(ctx: MemberContext, agentId: string, body: Record<string, unknown>) {
  const agent = await agentRow(ctx.orgId, agentId);
  if (!agent) throw new HttpError(404, "PS_REQUEST_001", "Agent not found");
  const zid = parseZolvaId(body.zolva_agent_id ?? agent.zolva_agent_id);
  if (!zid) throw new HttpError(422, "PS_REQUEST_001", "Link a Zolva agent first, or pass zolva_agent_id.");
  if (!agent.policy_id) throw new HttpError(422, "PS_POLICY_001", "This agent has no policy to test.");
  const which = body.version === "draft" ? "draft" : "active";
  const [p] = await db()`
    SELECT p.draft, pv.document AS active FROM policies p
    LEFT JOIN policy_versions pv ON pv.policy_id = p.id AND pv.version = p.active_version
    WHERE p.id = ${agent.policy_id}::uuid AND p.org_id = ${ctx.orgId}::uuid`;
  const doc = (which === "draft" ? p?.draft : p?.active) as Policy | null;
  if (!doc) throw new HttpError(422, "PS_POLICY_001", which === "draft" ? "This policy has no draft." : "This policy has no active version.");
  const capital = body.capital_usd === undefined || body.capital_usd === null ? null : Number(body.capital_usd);
  return replayPolicy(doc, which, zid, capital);
}
