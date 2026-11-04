import { hasBearer, idParam, requireAgent, requireMember } from "@/server/access";
import { cancel } from "@/server/approvals";
import { handle, ok } from "@/server/http";

/** Releases an unused, unexpired authorization (or a pending approval) and its budget. */
export const POST = handle<RouteContext<"/api/v1/operations/[id]/cancel">>(async (req, ctx) => {
  const id = await idParam(ctx);
  if (hasBearer(req)) {
    const agent = await requireAgent(req);
    return ok(await cancel(agent.orgId, id, { agent }));
  }
  const m = await requireMember(req, "operate");
  return ok(await cancel(m.orgId, id, { userId: m.user.userId }));
});
