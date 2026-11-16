import { requireMember } from "@/server/access";
import { listToolsFor } from "@/server/agent/runtime";
import { handle, ok } from "@/server/http";

/** Every tool, with whether it is available to this member at the current autonomy level. */
export const GET = handle(async (req) => ok(await listToolsFor(await requireMember(req, "read"))));
