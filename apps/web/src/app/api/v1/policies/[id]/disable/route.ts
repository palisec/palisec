import { idParam, requireMember } from "@/server/access";
import { disablePolicy } from "@/server/control";
import { handle, ok, readJson } from "@/server/http";

export const POST = handle<RouteContext<"/api/v1/policies/[id]/disable">>(async (req, ctx) =>
  ok(await disablePolicy(await requireMember(req, "manage"), await idParam(ctx), await readJson(req))),
);
