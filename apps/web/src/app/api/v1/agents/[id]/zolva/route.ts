import { idParam, requireMember } from "@/server/access";
import { BadRequest, handle, HttpError, ok } from "@/server/http";
import { agentRow, zolvaView } from "@/server/zolva";
import { setZolvaLink } from "@/server/zolva-link";

/**
 * Zolva: the agent's track record from Zolva (paper trading), the two-sided link and the on-chain
 * declaration for the account's owners. Display only. Members can read it; owners and admins link.
 */
export const GET = handle<RouteContext<"/api/v1/agents/[id]/zolva">>(async (req, ctx) => {
  const m = await requireMember(req, "read");
  const agent = await agentRow(m.orgId, await idParam(ctx));
  if (!agent) throw new HttpError(404, "PS_REQUEST_001", "Agent not found");
  return ok(await zolvaView(agent));
});

export const PUT = handle<RouteContext<"/api/v1/agents/[id]/zolva">>(async (req, ctx) => {
  const m = await requireMember(req, "manage");
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") throw new BadRequest("Body must be a JSON object with zolva_agent_id");
  return ok(await setZolvaLink(m, await idParam(ctx), body.zolva_agent_id));
});

export const DELETE = handle<RouteContext<"/api/v1/agents/[id]/zolva">>(async (req, ctx) => {
  const m = await requireMember(req, "manage");
  return ok(await setZolvaLink(m, await idParam(ctx), null));
});
