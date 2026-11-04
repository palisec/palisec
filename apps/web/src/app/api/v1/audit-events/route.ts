import { requireMember } from "@/server/access";
import { listAudit } from "@/server/control";
import { handle, ok } from "@/server/http";

/** Newest first. Page with ?before=<seq> from next_before. Filters: type (prefix match), agent_id. */
export const GET = handle(async (req) => ok(await listAudit(await requireMember(req, "read"), new URL(req.url).searchParams)));
