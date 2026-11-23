import { connection } from "next/server";
import { isUuid } from "@/server/access";
import { HttpError, handle, ok } from "@/server/http";
import { voteFile } from "@/server/mandates";
import { requireMandatesVisible } from "@/server/mandate-access";

/** Holder mandates: the full vote file (signatures, weights, snapshot holders, result) for an independent recount. */
export const GET = handle<RouteContext<"/api/v1/public/mandates/[slug]/proposals/[pid]/vote-file">>(async (req, ctx) => {
  await connection();
  await requireMandatesVisible(req);
  const { slug, pid } = await ctx.params;
  if (!isUuid(pid)) throw new HttpError(404, "PS_REQUEST_001", "Proposal not found");
  return ok(await voteFile(slug, pid), { headers: { "content-disposition": `attachment; filename="${slug}-proposal-vote-file.json"`, "cache-control": "no-store" } });
});
