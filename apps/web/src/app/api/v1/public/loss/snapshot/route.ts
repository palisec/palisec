import { connection } from "next/server";
import { HttpError, handle, ok, rateLimited } from "@/server/http";
import { runLossKeeper } from "@/server/loss-limits";

/**
 * Loss limits: measure every account with a loss limit now (also run hourly by the scheduled job). Safe to
 * call by anyone: it only reads the chain and records Palisec's own snapshots. The response is counts
 * only, because the scheduled job's log is public.
 */
export const POST = handle(async (req) => {
  await connection();
  if (rateLimited(req, "loss-snapshot", 4)) throw new HttpError(429, "PS_RATE_001", "Too many requests", true);
  return ok(await runLossKeeper());
});
