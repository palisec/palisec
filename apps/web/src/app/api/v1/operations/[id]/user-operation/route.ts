import { idParam, requireAgent } from "@/server/access";
import { handle, ok, rateLimited, tooManyRequests } from "@/server/http";
import { prepareExecution } from "@/server/smart-accounts";

/**
 * Builds the exact user operation PALISEC will co-sign for an allowed or approved operation, and returns
 * the typed data the agent signs with its own key. Nothing is signed or sent here.
 */
export const POST = handle<RouteContext<"/api/v1/operations/[id]/user-operation">>(async (req, ctx) => {
  const id = await idParam(ctx);
  const agent = await requireAgent(req, "operations:write");
  if (rateLimited(req, "user-operation", 30)) return tooManyRequests();
  return ok(await prepareExecution(agent, id));
});
