import { idParam, requireMember } from "@/server/access";
import { decideAction } from "@/server/agent/runtime";
import { handle, ok } from "@/server/http";

export const POST = handle<RouteContext<"/api/v1/agent/actions/[id]/reject">>(async (req, ctx) => ok(await decideAction(await requireMember(req, "read"), await idParam(ctx), "reject")));
