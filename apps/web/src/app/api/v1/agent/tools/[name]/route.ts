import { requireMember } from "@/server/access";
import { directTool } from "@/server/agent/runtime";
import { handle, HttpError, ok, readJson } from "@/server/http";

/** Runs one tool directly, without a model. Same availability, role and audit rules as model calls. */
export const POST = handle<RouteContext<"/api/v1/agent/tools/[name]">>(async (req, ctx) => {
  const m = await requireMember(req, "read");
  const { name } = await ctx.params;
  if (!/^[a-z_]{3,64}$/.test(name)) throw new HttpError(404, "PS_REQUEST_001", "Not found");
  return ok(await directTool(m, name, await readJson(req)));
});
