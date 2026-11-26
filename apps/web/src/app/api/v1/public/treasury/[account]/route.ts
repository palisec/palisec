import { connection } from "next/server";
import { HttpError } from "@/server/http";
import { publicTreasury } from "@/server/public-treasury";

/** The public treasury guard of one account: rules, lock, sells against the cap, decisions, recovery owner. */
export async function GET(_req: Request, ctx: { params: Promise<{ account: string }> }) {
  await connection();
  const { account } = await ctx.params;
  try {
    return Response.json(await publicTreasury(account), { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
    return Response.json({ error: { code: "PS_STATE_001", message: "Unavailable right now." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
