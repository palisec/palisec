import { connection } from "next/server";
import { HttpError, handle, rateLimited } from "@/server/http";
import { committedDocument } from "@/server/peaa";

/**
 * Policy publishing: a policy document committed on chain (draft ERC Policy-Enforced Agent Accounts), by its
 * policyHash. Only for accounts that opted in to publishing; content-addressed, so it never changes.
 */
export const GET = handle<RouteContext<"/api/v1/public/policies/[hash]">>(async (req, ctx) => {
  await connection();
  if (rateLimited(req, "policy-read", 120)) throw new HttpError(429, "PS_RATE_001", "Too many requests", true);
  const doc = await committedDocument((await ctx.params).hash.toLowerCase());
  if (doc === null) throw new HttpError(404, "PS_REQUEST_001", "No published policy document has this hash");
  return Response.json(doc, { headers: { "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" } });
});
