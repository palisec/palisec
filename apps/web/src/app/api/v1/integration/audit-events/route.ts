import { requireAgent } from "@/server/access";
import { handle, ok } from "@/server/http";
import { ownAuditEvents } from "@/server/integrations";

/** Audit events this agent caused (scope audit:read). */
export const GET = handle(async (req) => ok(await ownAuditEvents(await requireAgent(req, "audit:read"), new URL(req.url).searchParams)));
