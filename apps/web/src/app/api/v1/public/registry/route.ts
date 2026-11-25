import { connection } from "next/server";
import { publicRegistry } from "@/server/public-data";

/** Each public demo account's policy and stop state, read from the ERC-8511 registry v3 on chain. */
export async function GET() {
  await connection();
  const state = await publicRegistry();
  if (!state) return Response.json({ error: "The chain could not be read right now." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return Response.json(state, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
}
