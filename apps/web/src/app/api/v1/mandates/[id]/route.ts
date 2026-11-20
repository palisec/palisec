import { idParam, requireMember } from "@/server/access";
import { handle, ok } from "@/server/http";
import { getMandate } from "@/server/mandates";

export const GET = handle<RouteContext<"/api/v1/mandates/[id]">>(async (req, ctx) => ok(await getMandate(await requireMember(req, "read"), await idParam(ctx))));
