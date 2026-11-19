import { burnStats } from "@/server/billing";
import { logEvent } from "@/server/http";
import { connection } from "next/server";

/**
 * Public burn counter: every $PALISEC burned by the PalisecCredits contract, read from the chain (not the
 * database), with a transaction per row. Cached by the CDN for five minutes, so page views do not each
 * read the chain.
 */
export async function GET() {
  await connection();
  try {
    return Response.json(await burnStats(), { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch (e) {
    logEvent("warn", "token.burns_unavailable", { error: e instanceof Error ? e.message.slice(0, 160) : "error" });
    return Response.json({ configured: true, error: "The chain could not be read right now." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
