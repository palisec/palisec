import { idParam, requireMember } from "@/server/access";
import { activatePolicy } from "@/server/control";
import { handle, ok, readJson } from "@/server/http";

export const POST = handle<RouteContext<"/api/v1/policies/[id]/activate">>(async (req, ctx) =>
  ok(await activatePolicy(await requireMember(req, "manage"), await idParam(ctx), await readJson(req))),
);
