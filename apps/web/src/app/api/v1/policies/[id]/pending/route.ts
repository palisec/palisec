import { idParam, requireMember } from "@/server/access";
import { getPolicy } from "@/server/control";
import { handle, ok } from "@/server/http";

/** Loosening delay: the activation of this policy that is waiting out the loosening delay, if any. */
export const GET = handle<RouteContext<"/api/v1/policies/[id]/pending">>(async (req, ctx) => {
  const p = await getPolicy(await requireMember(req, "read"), await idParam(ctx));
  return ok({ policy_id: p.id, active_version: p.active_version, pending: p.pending });
});
