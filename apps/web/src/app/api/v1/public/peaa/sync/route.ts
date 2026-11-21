import { connection } from "next/server";
import { HttpError, handle, ok, rateLimited } from "@/server/http";
import { syncCommitments } from "@/server/peaa";

/**
 * Phase 8: publish opted-in accounts' policy changes to the registry now (also run hourly). Safe to
 * call by anyone: it only publishes Palisec's own authoritative state, and sends nothing when the
 * chain already matches.
 */
export const POST = handle(async (req) => {
  await connection();
  if (rateLimited(req, "peaa-sync", 6)) throw new HttpError(429, "PS_RATE_001", "Too many requests", true);
  const results = await syncCommitments(null);
  return ok({ results: results.map((r) => ({ account: r.account, sent: r.sent, skipped: r.skipped ?? null, error: r.error ? "sync failed" : null })) });
});
