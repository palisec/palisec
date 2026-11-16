import { idParam, requireMember } from "@/server/access";
import { continueRun } from "@/server/agent/runtime";
import { handle, ok } from "@/server/http";

export const maxDuration = 60;

export const POST = handle<RouteContext<"/api/v1/agent/runs/[id]/continue">>(async (req, ctx) => ok(await continueRun(await requireMember(req, "read"), await idParam(ctx))));
