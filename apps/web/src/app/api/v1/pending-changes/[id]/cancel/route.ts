import { idParam, requireMember } from "@/server/access";
import { handle, ok } from "@/server/http";
import { cancelPending } from "@/server/pending";

/** Loosening delay: cancels one pending change at once (owner, admin or operator). Audited and announced. */
export const POST = handle<RouteContext<"/api/v1/pending-changes/[id]/cancel">>(async (req, ctx) =>
  ok(await cancelPending(await requireMember(req, "operate"), await idParam(ctx))),
);
