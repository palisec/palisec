import { hasBearer, idParam, requireAgent, requireMember } from "@/server/access";
import { HttpError, handle, ok } from "@/server/http";
import { getOperation } from "@/server/operations";

/** An agent can read its own operations; members can read any in their organization. */
export const GET = handle<RouteContext<"/api/v1/operations/[id]">>(async (req, ctx) => {
  const id = await idParam(ctx);
  const op = hasBearer(req)
    ? await requireAgent(req, "operations:read").then((a) => getOperation(a.orgId, id, a.agentId))
    : await requireMember(req, "read").then((m) => getOperation(m.orgId, id));
  if (!op) throw new HttpError(404, "PS_REQUEST_001", "Operation not found");
  return ok(op);
});
