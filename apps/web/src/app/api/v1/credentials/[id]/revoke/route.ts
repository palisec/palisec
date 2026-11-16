import { idParam, requireMember } from "@/server/access";
import { revokeCredential } from "@/server/control";
import { afterChange } from "@/server/events";
import { handle, ok } from "@/server/http";

export const POST = handle<RouteContext<"/api/v1/credentials/[id]/revoke">>(async (req, ctx) => {
  const m = await requireMember(req, "manage");
  const id = await idParam(ctx);
  const out = await revokeCredential(m, id);
  afterChange(m.orgId, "credential.revoked", { credential_id: id });
  return ok(out);
});
