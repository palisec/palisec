import { idParam, requireMember } from "@/server/access";
import { setAgentStatus } from "@/server/control";
import { handle, ok, readJson } from "@/server/http";

/** Loosening delay: resuming is a loosening; it waits out the delay (policy.loosening_pending is sent now, agent.status_changed is not). */
export const POST = handle<RouteContext<"/api/v1/agents/[id]/resume">>(async (req, ctx) => {
  const m = await requireMember(req, "manage");
  return ok(await setAgentStatus(m, await idParam(ctx), "active", await readJson(req)));
});
