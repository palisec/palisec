import { requireMember } from "@/server/access";
import { handle, ok } from "@/server/http";
import { usage } from "@/server/usage";

/** Requests and outcomes per agent and key over 7 days, from the ledger. */
export const GET = handle(async (req) => ok(await usage(await requireMember(req, "read"))));
