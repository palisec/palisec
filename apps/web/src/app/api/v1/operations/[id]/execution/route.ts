import { hasBearer, idParam, requireAgent, requireMember } from "@/server/access";
import { handle, ok } from "@/server/http";
import { executionStatus } from "@/server/smart-accounts";

/** Where a submitted operation is: submitted, executed or reverted, with the transaction hash once known. */
export const GET = handle<RouteContext<"/api/v1/operations/[id]/execution">>(async (req, ctx) => {
  const id = await idParam(ctx);
  if (hasBearer(req)) {
    const agent = await requireAgent(req, "operations:read");
    return ok(await executionStatus(agent.orgId, id, agent.agentId));
  }
  const m = await requireMember(req, "read");
  return ok(await executionStatus(m.orgId, id));
});
