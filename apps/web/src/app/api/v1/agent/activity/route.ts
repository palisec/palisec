import { requireMember } from "@/server/access";
import { activity } from "@/server/agent/runtime";
import { handle, ok } from "@/server/http";

export const GET = handle(async (req) => ok(await activity(await requireMember(req, "read"))));
