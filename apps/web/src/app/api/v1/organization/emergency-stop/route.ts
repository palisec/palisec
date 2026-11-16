import { requireMember } from "@/server/access";
import { setEmergencyStop } from "@/server/control";
import { afterChange } from "@/server/events";
import { handle, ok, readJson } from "@/server/http";

/** Operators can stop; only owners can lift the stop (checked in setEmergencyStop). */
export const POST = handle(async (req) => {
  const m = await requireMember(req, "operate");
  const org = await setEmergencyStop(m, await readJson(req));
  afterChange(m.orgId, "organization.emergency_stop", { active: Boolean((org as { emergency_stop?: boolean }).emergency_stop) }, true);
  return ok(org);
});
