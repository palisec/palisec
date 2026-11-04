import { idParam, requireMember } from "@/server/access";
import { setAgentStatus } from "@/server/control";
import { handle, ok, readJson } from "@/server/http";

export const POST = handle<RouteContext<"/api/v1/agents/[id]/pause">>(async (req, ctx) =>
  ok(await setAgentStatus(await requireMember(req, "operate"), await idParam(ctx), "paused", await readJson(req))),
);
