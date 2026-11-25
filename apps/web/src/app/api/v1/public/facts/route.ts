import { connection } from "next/server";
import { publicFacts } from "@/server/public-data";

/** Totals of the last 24 hours across all organizations, counts only; any total under 10 is null. */
export async function GET() {
  await connection();
  const facts = await publicFacts();
  if (!facts) return Response.json({ error: "Unavailable right now." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return Response.json(facts, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
}
