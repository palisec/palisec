import { idParam, requireMember } from "@/server/access";
import { handle, ok, readJson } from "@/server/http";
import { setEnvelope } from "@/server/mandates";

/** The owner's hard limits. Tightening applies now; loosening waits out the loosening delay. */
export const POST = handle<RouteContext<"/api/v1/mandates/[id]/envelope">>(async (req, ctx) =>
  ok(await setEnvelope(await requireMember(req, "own"), await idParam(ctx), await readJson(req))),
);
