import { HttpError, handle, ok, rateLimited, readJson } from "@/server/http";
import { createProposal } from "@/server/mandates";
import { requireMandatePreview } from "@/server/mandate-preview";

/** Phase 7: a holder opens a proposal with an EIP-712 signature (no sign-in, no gas). */
export const POST = handle<RouteContext<"/api/v1/public/mandates/[slug]/proposals">>(async (req, ctx) => {
  if (rateLimited(req, "mandate-propose", 6)) throw new HttpError(429, "PS_RATE_001", "Too many proposals from this address", true);
  await requireMandatePreview(req);
  return ok(await createProposal((await ctx.params).slug, await readJson(req)), { status: 201 });
});
