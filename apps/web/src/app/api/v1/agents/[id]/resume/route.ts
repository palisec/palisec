import { idParam, requireMember } from "@/server/access";
import { setAgentStatus } from "@/server/control";
import { handle, ok, readJson } from "@/server/http";

/** Resuming needs an administrator, not just an operator (spec §11.8). */
export const POST = handle<RouteContext<"/api/v1/agents/[id]/resume">>(async (req, ctx) =>
  ok(await setAgentStatus(await requireMember(req, "manage"), await idParam(ctx), "active", await readJson(req))),
);
