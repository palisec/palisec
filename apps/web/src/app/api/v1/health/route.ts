import { engineStatus } from "@palisec/policy-engine";
import { secretsConfigured } from "@/server/secrets";
import { smartAccountsStatus } from "@/server/smart-accounts";
import { CHAINS, defaultChain, isDatabaseConfigured } from "@/server/config";
import { MAINNET, TESTNET } from "@/lib/networks";
import { db } from "@/server/db";
import { handle, ok } from "@/server/http";
import { connection } from "next/server";

const CACHE_MS = 30_000;
let cached: { at: number; database: "unreachable" | "ok"; schema: string | null } | null = null;

/**
 * Reports what is actually reachable. Never claims a component that is not deployed.
 * `?shallow=1` reports only whether a database is configured, so page views cannot wake a
 * scale-to-zero database; it answers "configured" and never "ok".
 */
export const GET = handle(async (req: Request) => {
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
  // Decisions need both the Rust engine and the reference evaluator; without the engine they fail closed.
  const engine = engineStatus();
  const main = smartAccountsStatus(MAINNET);
  const test = smartAccountsStatus(TESTNET);
  return ok({
    status: database === "ok" && engine.ok ? "ok" : "degraded",
    components: {
      database,
      auth: database === "ok" ? "ok" : "unavailable",
      policy_engine: engine.ok ? "ok" : "unavailable",
      // Server-held co-signers, one per network; the enclave signer is a later upgrade.
      signer: test.signer ? "testnet_cosigner" : "not_configured",
      mainnet_signer: !main.enabled ? "mainnet_disabled" : main.signer ? "mainnet_cosigner" : "not_configured",
      bundler: test.bundler ? "configured" : "not_configured",
    },
    schema_migration: schema,
    policy_engine: { implementation: "rust-wasm+reference", version: engine.version, source_hash: engine.source_hash.slice(0, 12) },
    // Whether optional features are configured on this deployment (never the values).
    features: { agent_model: Boolean(process.env.PALISEC_AGENT_API_KEY), webhooks: secretsConfigured(), mcp: true, smart_accounts: test.available || main.available },
    default_chain: defaultChain(),
    chains: Object.entries(CHAINS).map(([id, c]) => {
      const s = smartAccountsStatus(Number(id));
      return { chain_id: Number(id), name: c.name, testnet: c.testnet, enabled: c.enabled, smart_accounts: s.available };
    }),
  });
});
