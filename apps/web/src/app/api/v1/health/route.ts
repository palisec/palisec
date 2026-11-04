import { CHAINS, isDatabaseConfigured } from "@/server/config";
import { db } from "@/server/db";
import { ok } from "@/server/http";
import { connection } from "next/server";

const CACHE_MS = 30_000;
let cached: { at: number; database: "unreachable" | "ok"; schema: string | null } | null = null;

/**
 * Reports what is actually reachable. Never claims a component that is not deployed.
 * `?shallow=1` reports only whether a database is configured, so page views cannot wake a
 * scale-to-zero database; it answers "configured" and never "ok".
 */
export async function GET(req: Request) {
  // Health must be observed per request, never prerendered into the build.
  await connection();
  if (new URL(req.url).searchParams.has("shallow")) {
    return ok({ components: { database: isDatabaseConfigured() ? "configured" : "unconfigured" } });
  }
  let database: "unconfigured" | "unreachable" | "ok" = "unconfigured";
  let schema: string | null = null;
  if (isDatabaseConfigured()) {
    // Cached, so frequent checks cost at most one query per 30 seconds.
    if (!cached || Date.now() - cached.at > CACHE_MS) {
      try {
        const rows = await db()`SELECT max(version) AS v FROM schema_migrations`;
        cached = { at: Date.now(), database: "ok", schema: rows[0]?.v ?? null };
      } catch {
        cached = { at: Date.now(), database: "unreachable", schema: null };
      }
    }
    database = cached.database;
    schema = cached.schema;
  }
  return ok({
    status: database === "ok" ? "ok" : "degraded",
    components: {
      database,
      auth: database === "ok" ? "ok" : "unavailable",
      // The TypeScript reference evaluator runs in this process; the Rust engine is not deployed.
      policy_engine: "ok",
      signer: "not_deployed",
      bundler: "not_deployed",
    },
    schema_migration: schema,
    chains: Object.entries(CHAINS).map(([id, c]) => ({ chain_id: Number(id), name: c.name, enabled: c.enabled })),
  });
}
