import { idParam, requireMember } from "@/server/access";
import { handle, ok } from "@/server/http";
import { redeliver } from "@/server/webhooks";

/** Sends a failed delivery again with the same event ID, so receivers can deduplicate. */
export const POST = handle<RouteContext<"/api/v1/webhook-deliveries/[id]/redeliver">>(async (req, ctx) =>
  ok(await redeliver(await requireMember(req, "manage"), await idParam(ctx))),
);
