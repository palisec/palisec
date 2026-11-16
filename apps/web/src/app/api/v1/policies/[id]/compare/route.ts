import { idParam, requireMember } from "@/server/access";
import { handle, ok } from "@/server/http";
import { comparePolicy } from "@/server/usage";

/** Field-by-field changes between two versions (?from=1&to=2), or a version and the draft (?from=1). */
export const GET = handle<RouteContext<"/api/v1/policies/[id]/compare">>(async (req, ctx) =>
  ok(await comparePolicy(await requireMember(req, "read"), await idParam(ctx), new URL(req.url).searchParams)),
);
