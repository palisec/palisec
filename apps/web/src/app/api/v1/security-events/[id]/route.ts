import { idParam, requireMember } from "@/server/access";
import { handle, ok, readJson } from "@/server/http";
import { setFindingStatus } from "@/server/security-events";

/** Acknowledge or resolve a finding (operators). */
export const PATCH = handle<RouteContext<"/api/v1/security-events/[id]">>(async (req, ctx) => {
  const m = await requireMember(req, "operate");
  return ok(await setFindingStatus(m, await idParam(ctx), (await readJson(req)).status));
});
