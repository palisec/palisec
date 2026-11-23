import { idParam, requireMember } from "@/server/access";
import { handle, HttpError, ok, rateLimited } from "@/server/http";
import { replayForAgent } from "@/server/zolva-link";

// Zolva can take several seconds to answer each read.
export const maxDuration = 60;

/**
 * Test a policy before going live: replays the agent's policy (active or draft, both engines) against a
 * Zolva agent's recorded paper trades and reports which it would have blocked, with reason codes.
 * Read only: nothing is recorded, reserved, signed or sent.
 */
export const POST = handle<RouteContext<"/api/v1/agents/[id]/zolva/replay">>(async (req, ctx) => {
  const m = await requireMember(req, "read");
  if (rateLimited(req, `zolva-replay:${m.orgId}`, 10)) throw new HttpError(429, "PS_RATE_001", "Too many replays; try again in a minute", true);
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  return ok(await replayForAgent(m, await idParam(ctx), body));
});
