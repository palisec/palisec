import { isUuid } from "@/server/access";
import { HttpError, handle, ok, rateLimited, readJson } from "@/server/http";
import { submitVote } from "@/server/mandates";
import { requireMandatesVisible } from "@/server/mandate-access";

/** Holder mandates: a holder's signed vote (gasless). A later vote from the same address replaces the earlier one. */
export const POST = handle<RouteContext<"/api/v1/public/mandates/[slug]/proposals/[pid]/votes">>(async (req, ctx) => {
  const { slug, pid } = await ctx.params;
  if (!isUuid(pid)) throw new HttpError(404, "PS_REQUEST_001", "Proposal not found");
  if (rateLimited(req, "mandate-vote", 30)) throw new HttpError(429, "PS_RATE_001", "Too many votes from this address", true);
  await requireMandatesVisible(req);
  return ok(await submitVote(slug, pid, await readJson(req)));
});
