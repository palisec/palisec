import { isUuid, requireMember } from "@/server/access";
import { HttpError, handle, ok, readJson } from "@/server/http";
import { cancelProposal } from "@/server/mandates";

/** The safety valve (owner, admin or operator): cancel a passed loosening that is waiting. Reason required; shown publicly. */
export const POST = handle<RouteContext<"/api/v1/mandates/[id]/proposals/[pid]/cancel">>(async (req, ctx) => {
  const { id, pid } = await ctx.params;
  if (!isUuid(id) || !isUuid(pid)) throw new HttpError(404, "PS_REQUEST_001", "Not found");
  return ok(await cancelProposal(await requireMember(req, "operate"), id, pid, await readJson(req)));
});
