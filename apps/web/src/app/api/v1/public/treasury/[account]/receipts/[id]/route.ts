import { connection } from "next/server";
import { HttpError } from "@/server/http";
import { publicTreasuryReceipt } from "@/server/public-treasury";

/** The signed ERC-8511 decision receipt of one treasury decision on a guarded account. */
export async function GET(_req: Request, ctx: { params: Promise<{ account: string; id: string }> }) {
  await connection();
  const { account, id } = await ctx.params;
  try {
    return Response.json(await publicTreasuryReceipt(account, id), { headers: { "Cache-Control": "public, s-maxage=3600" } });
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
    return Response.json({ error: { code: "PS_STATE_001", message: "Unavailable right now." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
