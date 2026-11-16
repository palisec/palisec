import { idParam, requireMember } from "@/server/access";
import { cancelRun } from "@/server/agent/runtime";
import { handle, ok } from "@/server/http";

export const POST = handle<RouteContext<"/api/v1/agent/runs/[id]/cancel">>(async (req, ctx) => ok(await cancelRun(await requireMember(req, "read"), await idParam(ctx))));
