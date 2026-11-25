import { idParam, requireAgent } from "@/server/access";
import { handle, ok, rateLimited, readJson, tooManyRequests } from "@/server/http";
import { submitExecution } from "@/server/smart-accounts";

/** Takes the agent's signature, adds Palisec's co-signature once, and submits through the bundler. */
export const POST = handle<RouteContext<"/api/v1/operations/[id]/submit">>(async (req, ctx) => {
  const id = await idParam(ctx);
  const agent = await requireAgent(req, "operations:write");
  if (rateLimited(req, "submit", 30)) return tooManyRequests();
  return ok(await submitExecution(agent, id, await readJson(req, 2048)), { status: 202 });
});
