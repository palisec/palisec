import { requireMember } from "@/server/access";
import { setEmergencyStop } from "@/server/control";
import { afterChange } from "@/server/events";
import { handle, ok, readJson } from "@/server/http";

/**
 * Operators can stop (instant); only owners can lift the stop (checked in setEmergencyStop), and a lift
 * waits out the organization's lift delay (Phase 6). The stop event is sent when the state changes.
 */
export const POST = handle(async (req) => {
  const m = await requireMember(req, "operate");
  const body = await readJson(req);
  const org = (await setEmergencyStop(m, body)) as { emergency_stop?: boolean };
  if (body.active === true) afterChange(m.orgId, "organization.emergency_stop", { active: true }, true);
  return ok(org);
});
