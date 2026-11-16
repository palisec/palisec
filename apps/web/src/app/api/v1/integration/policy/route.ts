import { requireAgent } from "@/server/access";
import { handle, ok } from "@/server/http";
import { boundPolicy } from "@/server/integrations";

/** The exact active policy version this agent is evaluated against (scope policy:read). */
export const GET = handle(async (req) => ok(await boundPolicy(await requireAgent(req, "policy:read"))));
