import { idParam, requireMember } from "@/server/access";
import { handle, ok, readJson } from "@/server/http";
import { deleteWebhook, updateWebhook } from "@/server/webhooks";

export const PATCH = handle<RouteContext<"/api/v1/webhooks/[id]">>(async (req, ctx) => {
  const m = await requireMember(req, "manage");
  return ok(await updateWebhook(m, await idParam(ctx), await readJson(req)));
});

export const DELETE = handle<RouteContext<"/api/v1/webhooks/[id]">>(async (req, ctx) =>
  ok(await deleteWebhook(await requireMember(req, "manage"), await idParam(ctx))),
);
