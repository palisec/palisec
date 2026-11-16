import { requireAgent } from "@/server/access";
import { handle, ok } from "@/server/http";
import { ownOperations } from "@/server/integrations";

/** This agent's own operations, newest first (scope operations:read). */
export const GET = handle(async (req) => ok(await ownOperations(await requireAgent(req, "operations:read"), new URL(req.url).searchParams)));
