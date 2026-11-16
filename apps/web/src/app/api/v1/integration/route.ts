import { requireAgent } from "@/server/access";
import { handle, ok } from "@/server/http";
import { whoAmI } from "@/server/integrations";

/** The integration this API key belongs to: agent, account, scopes and bound policy. Any valid key. */
export const GET = handle(async (req) => ok(await whoAmI(await requireAgent(req, null))));
