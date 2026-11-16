import { idParam, requireMember } from "@/server/access";
import { handle, ok } from "@/server/http";
import { listDeliveries } from "@/server/webhooks";

export const GET = handle<RouteContext<"/api/v1/webhooks/[id]/deliveries">>(async (req, ctx) =>
  ok({ deliveries: await listDeliveries(await requireMember(req, "read"), await idParam(ctx)) }),
);
