import { connection } from "next/server";
import { HttpError, handle, ok, rateLimited } from "@/server/http";
import { publicMandate } from "@/server/mandates";
import { requireMandatePreview } from "@/server/mandate-preview";

/** Phase 7: a mandate's public state (no sign-in). Real data only; nothing private. */
export const GET = handle<RouteContext<"/api/v1/public/mandates/[slug]">>(async (req, ctx) => {
  await connection();
  if (rateLimited(req, "mandate-read", 120)) throw new HttpError(429, "PS_RATE_001", "Too many requests", true);
  await requireMandatePreview(req);
  return ok(await publicMandate((await ctx.params).slug), { headers: { "cache-control": "no-store" } });
});
