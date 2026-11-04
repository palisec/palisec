import { hasBearer, idParam, requireAgent, requireMember } from "@/server/access";
import { cancel } from "@/server/approvals";
import { handle, ok } from "@/server/http";

/**
 * Agents may withdraw a pending approval. Releasing an authorization's budget needs a console
 * operator, because only a person can vouch that the transaction was not sent.
 */
export const POST = handle<RouteContext<"/api/v1/operations/[id]/cancel">>(async (req, ctx) => {
  const id = await idParam(ctx);
  if (hasBearer(req)) {
    const agent = await requireAgent(req);
    return ok(await cancel(agent.orgId, id, { agent }));
  }
  const m = await requireMember(req, "operate");
  return ok(await cancel(m.orgId, id, { userId: m.user.userId }));
});
