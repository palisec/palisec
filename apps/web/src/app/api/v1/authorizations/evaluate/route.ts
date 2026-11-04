import { requireAgent } from "@/server/access";
import { handle, ok, readJson } from "@/server/http";
import { dryRun, MAX_OPERATION_BODY, parseIntent } from "@/server/operations";

/** Dry run against live state and the active policy. Reserves nothing and does not consume request_id. */
export const POST = handle(async (req) => {
  const agent = await requireAgent(req);
  return ok(await dryRun(agent, parseIntent(await readJson(req, MAX_OPERATION_BODY))));
});
