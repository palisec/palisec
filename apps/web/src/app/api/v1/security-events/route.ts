import { requireMember } from "@/server/access";
import { handle, ok } from "@/server/http";
import { listSecurityEvents } from "@/server/security-events";

/** Findings from the deterministic detectors, with evidence. `?refresh=1` re-runs detection now. */
export const GET = handle(async (req) => ok(await listSecurityEvents(await requireMember(req, "read"), new URL(req.url).searchParams)));
