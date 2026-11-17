import { idParam, requireMember } from "@/server/access";
import { approve } from "@/server/approvals";
import { afterChange } from "@/server/events";
import { handle, ok, readJson } from "@/server/http";

export const POST = handle<RouteContext<"/api/v1/approvals/[id]/approve">>(async (req, ctx) => {
  const m = await requireMember(req, "approve");
  const op = await approve(m, await idParam(ctx), await readJson(req));
  if (op) afterChange(m.orgId, "approval.approved", { operation_id: op.operation_id, request_id: op.request_id, chain_id: op.details?.chain_id ?? null, authorization_id: op.authorization_id, expires_at: op.expires_at });
  return ok(op);
});
