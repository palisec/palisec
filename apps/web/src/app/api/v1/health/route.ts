import { CHAINS, isDatabaseConfigured } from "@/server/config";
import { db } from "@/server/db";
import { ok } from "@/server/http";
import { connection } from "next/server";

/** Reports what is actually reachable. Never claims a component that is not deployed. */
export async function GET() {
  // Health must be observed per request, never prerendered into the build.
  await connection();
  let database: "unconfigured" | "unreachable" | "ok" = "unconfigured";
  let schema: string | null = null;
  if (isDatabaseConfigured()) {
    try {
      const rows = await db()`SELECT max(version) AS v FROM schema_migrations`;
      database = "ok";
      schema = rows[0]?.v ?? null;
    } catch {
      database = "unreachable";
    }
  }
  return ok({
    status: database === "ok" ? "ok" : "degraded",
    components: {
      database,
      auth: database === "ok" ? "ok" : "unavailable",
      policy_engine: "not_deployed",
      signer: "not_deployed",
      bundler: "not_deployed",
    },
    schema_migration: schema,
    chains: Object.entries(CHAINS).map(([id, c]) => ({ chain_id: Number(id), name: c.name, enabled: c.enabled })),
  });
}
