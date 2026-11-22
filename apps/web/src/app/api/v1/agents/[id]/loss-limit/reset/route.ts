import { idParam, requireMember } from "@/server/access";
import { BadRequest, handle, ok, readJson } from "@/server/http";
import { requestLossReset } from "@/server/loss-reset";

/**
 * Phase 9: the owner resets a breached loss limit. A loosening: it waits for the organization's delay
 * (alert, countdown, Cancel under pending changes) and is published on chain like any policy change.
 */
export const POST = handle<RouteContext<"/api/v1/agents/[id]/loss-limit/reset">>(async (req, ctx) => {
  const m = await requireMember(req, "own");
  const body = await readJson(req);
  if (body.confirm !== true) throw new BadRequest('This action needs explicit confirmation: send "confirm": true');
  return ok(await requestLossReset(m, await idParam(ctx), body));
});
