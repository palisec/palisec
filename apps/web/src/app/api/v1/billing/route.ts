import { requireMember } from "@/server/access";
import { billingSummary } from "@/server/billing";
import { handle, ok } from "@/server/http";

/** Console: this month's metered decisions, credits, purchases (read from the chain), Pro status and limits. */
export const GET = handle(async (req) => ok(await billingSummary(await requireMember(req, "read"))));
