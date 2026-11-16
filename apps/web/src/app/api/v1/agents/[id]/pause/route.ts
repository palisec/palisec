import { idParam, requireMember } from "@/server/access";
import { setAgentStatus } from "@/server/control";
import { afterChange } from "@/server/events";
import { handle, ok, readJson } from "@/server/http";

export const POST = handle<RouteContext<"/api/v1/agents/[id]/pause">>(async (req, ctx) => {
  const m = await requireMember(req, "operate");
  const id = await idParam(ctx);
  const agent = await setAgentStatus(m, id, "paused", await readJson(req));
  afterChange(m.orgId, "agent.status_changed", { agent_id: id, status: "paused" }, true);
  return ok(agent);
});
