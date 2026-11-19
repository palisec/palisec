import { idParam, requireMember } from "@/server/access";
import { getPolicy } from "@/server/control";
import { HttpError, handle, ok } from "@/server/http";
import { cancelPending } from "@/server/pending";

/** Phase 6: cancels this policy's pending activation at once (owner, admin or operator). */
export const POST = handle<RouteContext<"/api/v1/policies/[id]/pending/cancel">>(async (req, ctx) => {
  const m = await requireMember(req, "operate");
  const id = await idParam(ctx);
  const p = await getPolicy(m, id);
  if (!p.pending) throw new HttpError(404, "PS_REQUEST_001", "This policy has no pending activation");
  const cancelled = await cancelPending(m, p.pending.id);
  return ok({ cancelled, policy: await getPolicy(m, id) });
});
