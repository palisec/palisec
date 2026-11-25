import { connection } from "next/server";
import { publicProof } from "@/server/public-data";

/** Decisions of the public demo accounts only: ?limit=25&page=1&result=all|allowed|held|blocked */
export async function GET(req: Request) {
  await connection();
  const q = new URL(req.url).searchParams;
  const result = ["all", "allowed", "held", "blocked"].includes(q.get("result") ?? "") ? (q.get("result") as string) : "all";
  const proof = await publicProof({ limit: Number(q.get("limit") ?? 25), page: Number(q.get("page") ?? 1), result });
  if (!proof) return Response.json({ error: "Unavailable right now." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  return Response.json(proof, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
}
