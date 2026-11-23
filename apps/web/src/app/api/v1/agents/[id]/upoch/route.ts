import { idParam, requireMember } from "@/server/access";
import { getAgent } from "@/server/control";
import { handle, ok } from "@/server/http";
import { memberAddresses, readUpoch, upochScore } from "@/server/upoch";

/**
 * Upoch: the agent's Upoch status, read live from Upoch's public contract (read-only). `available:
 * false` means it could not be read: the console then shows "Unknown", never a guess.
 */
export const GET = handle<RouteContext<"/api/v1/agents/[id]/upoch">>(async (req, ctx) => {
  const m = await requireMember(req, "read");
  const agent = (await getAgent(m, await idParam(ctx))) as Record<string, unknown>;
  const workflowId = (agent.upoch_workflow_id as string | null) ?? null;
  const [d, score] = await Promise.all([
    memberAddresses(m.orgId).then((members) => readUpoch(Number(agent.chain_id), String(agent.account), workflowId, members)),
    upochScore(Number(agent.chain_id), workflowId),
  ]);
  const now = Math.floor(Date.now() / 1000);
  return ok({
    agent_id: agent.id,
    workflow_id: workflowId,
    available: d !== null,
    recoverable: d === null || !workflowId ? null : d.linked && d.active && d.checkpoint_count > 0,
    last_checkpoint_at: d?.last_checkpoint_at ? new Date(d.last_checkpoint_at * 1000).toISOString() : null,
    last_checkpoint_age_seconds: d?.last_checkpoint_at ? now - d.last_checkpoint_at : null,
    checkpoint_count: d?.checkpoint_count ?? null,
    guardians: d?.guardians ?? null,
    linked: d?.linked ?? null,
    active: d?.active ?? null,
    // From Upoch's public badge; null (Unknown) when Upoch has no score for it or cannot be reached.
    upoch_score: score?.score ?? null,
    upoch_grade: score?.grade ?? null,
    upoch_url: d?.url ?? null,
    read_at: new Date().toISOString(),
  });
});
