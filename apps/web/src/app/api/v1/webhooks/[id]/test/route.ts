import { idParam, requireMember } from "@/server/access";
import { handle, ok } from "@/server/http";
import { pingWebhook } from "@/server/webhooks";

/** Sends a signed `ping` event now and returns the delivery result. */
export const POST = handle<RouteContext<"/api/v1/webhooks/[id]/test">>(async (req, ctx) =>
  ok(await pingWebhook(await requireMember(req, "manage"), await idParam(ctx))),
);
