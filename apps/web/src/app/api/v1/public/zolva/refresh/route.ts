import { connection } from "next/server";
import { HttpError, handle, ok, rateLimited } from "@/server/http";
import { refreshLinked } from "@/server/zolva";

/**
 * Zolva: refresh every linked Zolva agent and re-check bigger limits (also run hourly by the scheduled
 * job). Safe to call by anyone: reads go through the 5-minute cache, so Zolva is never read more often.
 * The response is counts only, because the scheduled job's log is public.
 */
export const POST = handle(async (req) => {
  await connection();
  if (rateLimited(req, "zolva-refresh", 4)) throw new HttpError(429, "PS_RATE_001", "Too many requests", true);
  return ok(await refreshLinked());
});
