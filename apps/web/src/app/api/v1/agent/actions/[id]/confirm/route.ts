import { idParam, requireMember } from "@/server/access";
import { decideAction } from "@/server/agent/runtime";
import { handle, ok } from "@/server/http";

/** A member confirms an action the agent prepared; it runs as that member, with that member's role. */
export const POST = handle<RouteContext<"/api/v1/agent/actions/[id]/confirm">>(async (req, ctx) => ok(await decideAction(await requireMember(req, "read"), await idParam(ctx), "confirm")));
