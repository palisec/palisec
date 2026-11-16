import { requireMember } from "@/server/access";
import { handle, ok, readJson } from "@/server/http";
import { createWebhook, EVENT_TYPES, listWebhooks } from "@/server/webhooks";

export const GET = handle(async (req) => ok({ webhooks: await listWebhooks(await requireMember(req, "read")), event_types: EVENT_TYPES }));

/** Creates a webhook; the signing secret is returned once. */
export const POST = handle(async (req) => {
  const ctx = await requireMember(req, "manage");
  return ok(await createWebhook(ctx, await readJson(req)), { status: 201 });
});
