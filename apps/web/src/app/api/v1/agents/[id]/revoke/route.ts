import { idParam, requireMember } from "@/server/access";
import { setAgentStatus } from "@/server/control";
import { afterChange } from "@/server/events";
import { handle, ok, readJson } from "@/server/http";

export const POST = handle<RouteContext<"/api/v1/agents/[id]/revoke">>(async (req, ctx) => {
  const m = await requireMember(req, "manage");
  const id = await idParam(ctx);
  const agent = await setAgentStatus(m, id, "revoked", await readJson(req));
  afterChange(m.orgId, "agent.status_changed", { agent_id: id, status: "revoked" }, false);
  return ok(agent);
});
