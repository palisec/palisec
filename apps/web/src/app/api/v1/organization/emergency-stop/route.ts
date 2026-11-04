import { requireMember } from "@/server/access";
import { setEmergencyStop } from "@/server/control";
import { handle, ok, readJson } from "@/server/http";

/** Operators can stop; only owners can lift the stop (checked in setEmergencyStop). */
export const POST = handle(async (req) => ok(await setEmergencyStop(await requireMember(req, "operate"), await readJson(req))));
