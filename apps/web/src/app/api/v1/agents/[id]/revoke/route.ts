import { idParam, requireMember } from "@/server/access";
import { setAgentStatus } from "@/server/control";
import { handle, ok, readJson } from "@/server/http";

/** Permanent: the agent and all its API keys stop working. */
export const POST = handle<RouteContext<"/api/v1/agents/[id]/revoke">>(async (req, ctx) =>
  ok(await setAgentStatus(await requireMember(req, "manage"), await idParam(ctx), "revoked", await readJson(req))),
);
