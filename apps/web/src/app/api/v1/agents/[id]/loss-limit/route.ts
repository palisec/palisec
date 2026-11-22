import { idParam, requireMember } from "@/server/access";
import { HttpError, handle, ok } from "@/server/http";
import { lossStatus } from "@/server/loss-limits";

/**
 * Phase 9: the agent's loss limit as last measured (value, window peak, loss and drawdown against the
 * limits, paused or not, a pending reset with its effective time). No chain reads: the value is measured
 * before every decision and hourly.
 */
export const GET = handle<RouteContext<"/api/v1/agents/[id]/loss-limit">>(async (req, ctx) => {
  const m = await requireMember(req, "read");
  const s = await lossStatus(m.orgId, await idParam(ctx));
  if (!s) throw new HttpError(404, "PS_REQUEST_001", "Agent not found");
  return ok(s);
});
