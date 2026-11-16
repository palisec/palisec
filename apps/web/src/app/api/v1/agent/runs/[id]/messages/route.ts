import { idParam, requireMember } from "@/server/access";
import { addMessage } from "@/server/agent/runtime";
import { handle, ok, readJson } from "@/server/http";

export const maxDuration = 60;

export const POST = handle<RouteContext<"/api/v1/agent/runs/[id]/messages">>(async (req, ctx) => {
  const m = await requireMember(req, "read");
  return ok(await addMessage(m, await idParam(ctx), await readJson(req)));
});
