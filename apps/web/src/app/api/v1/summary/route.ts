import { requireMember } from "@/server/access";
import { summary } from "@/server/approvals";
import { handle, ok } from "@/server/http";

export const GET = handle(async (req) => ok(await summary(await requireMember(req, "read"))));
