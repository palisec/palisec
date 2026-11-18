import { requireAgent } from "@/server/access";
import { HttpError, handle, ok, readJson } from "@/server/http";
import { dryRun, MAX_OPERATION_BODY, parseIntent } from "@/server/operations";

/**
 * Dry run against live state and the active policy. Reserves nothing and does not consume request_id.
 * Allowed with `operations:write` or the dry-run-only `authorizations:evaluate` scope.
 */
export const POST = handle(async (req) => {
  const agent = await requireAgent(req, null);
  if (!agent.scopes.includes("operations:write") && !agent.scopes.includes("authorizations:evaluate"))
    throw new HttpError(403, "PS_AUTH_001", "This API key does not have the authorizations:evaluate scope");
  return ok(await dryRun(agent, parseIntent(await readJson(req, MAX_OPERATION_BODY))));
});
