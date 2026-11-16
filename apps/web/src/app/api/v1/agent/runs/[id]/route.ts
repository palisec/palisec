import { idParam, requireMember } from "@/server/access";
import { getRun } from "@/server/agent/runtime";
import { handle, ok } from "@/server/http";

export const GET = handle<RouteContext<"/api/v1/agent/runs/[id]">>(async (req, ctx) => ok(await getRun(await requireMember(req, "read"), await idParam(ctx))));
