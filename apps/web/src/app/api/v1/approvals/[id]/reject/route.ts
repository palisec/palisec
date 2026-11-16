import { idParam, requireMember } from "@/server/access";
import { reject } from "@/server/approvals";
import { afterChange } from "@/server/events";
import { handle, ok, readJson } from "@/server/http";

export const POST = handle<RouteContext<"/api/v1/approvals/[id]/reject">>(async (req, ctx) => {
  const m = await requireMember(req, "approve");
  const op = await reject(m, await idParam(ctx), await readJson(req));
  if (op) afterChange(m.orgId, "approval.rejected", { operation_id: op.operation_id, request_id: op.request_id }, true);
  return ok(op);
});
