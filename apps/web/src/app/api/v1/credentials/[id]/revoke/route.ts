import { idParam, requireMember } from "@/server/access";
import { revokeCredential } from "@/server/control";
import { handle, ok } from "@/server/http";

export const POST = handle<RouteContext<"/api/v1/credentials/[id]/revoke">>(async (req, ctx) =>
  ok(await revokeCredential(await requireMember(req, "manage"), await idParam(ctx))),
);
