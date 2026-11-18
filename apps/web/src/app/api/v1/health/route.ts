import { engineStatus } from "@palisec/policy-engine";
import { secretsConfigured } from "@/server/secrets";
import { bundlerState, signerState, smartAccountsStatus } from "@/server/smart-accounts";
import { CHAINS, defaultChain, isDatabaseConfigured } from "@/server/config";
import { MAINNET, TESTNET } from "@/lib/networks";
import { bundlerReason, cosignerReason, httpStatusFor, overallStatus, type HealthCheck } from "@/lib/health-status";
import { db } from "@/server/db";
import { handle, ok } from "@/server/http";
import { connection } from "next/server";

const CACHE_MS = 30_000;
let cached: { at: number; database: "unreachable" | "ok"; schema: string | null; signed: Record<number, string> } | null = null;

/**
 * Reports what is actually reachable. Never claims a component that is not deployed.
 * Overall `status` is "ok" (HTTP 200) only when every check passes; "degraded" (execution or a
 * non-critical part is not working, decisions still work) and "down" (decisions are refused) answer
 * HTTP 503, so uptime monitors notice. Rules: src/lib/health-status.ts.
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
        // Proof that each co-signer really signs: the time of the last operation PALISEC co-signed that
        // then succeeded on chain. Only the time is reported; which account or transaction stays private.
        // A failure here only loses the proof; it never marks the database down.
        const signed: Record<number, string> = {};
        try {
          const last = await db()`
            SELECT chain_id, max(executed_at) AS at FROM operations
            WHERE user_op_hash IS NOT NULL AND execution_success = true GROUP BY chain_id`;
          for (const r of last) if (r.at) signed[Number(r.chain_id)] = new Date(r.at).toISOString();
        } catch { /* reported as configured, not verified */ }
        cached = { at: Date.now(), database: "ok", schema: rows[0]?.v ?? null, signed };
      } catch {
        cached = { at: Date.now(), database: "unreachable", schema: null, signed: {} };
      }
    }
    database = cached.database;
    schema = cached.schema;
  }
  const signedAt = (chainId: number) => cached?.signed[chainId] ?? null;
  // "verified" when a real transaction proved the key signs; otherwise only its presence was checked.
  const cosigner = (state: ReturnType<typeof signerState>, chainId: number) => {
    const at = state === "configured" ? signedAt(chainId) : null;
    return { verified: at !== null, state: at ? "verified_by_transaction" : state, last_success_at: at };
  };
  // Decisions need both the Rust engine and the reference evaluator; without the engine they fail closed.
  const engine = engineStatus();
  const main = smartAccountsStatus(MAINNET);
  const test = smartAccountsStatus(TESTNET);
  const [mainnetBundler, testnetBundler] = await Promise.all([bundlerState(MAINNET), bundlerState(TESTNET)]);
  const mainSigner = signerState(MAINNET);
  const testSigner = signerState(TESTNET);
  const agentModel = Boolean(process.env.PALISEC_AGENT_API_KEY);
  const webhooks = secretsConfigured();

  const decisionsDown = "Decisions are refused (fail closed) until it is back.";
  const checks: HealthCheck[] = [
    { id: "database", label: "Database", critical: "decisions", configured: database !== "unconfigured", ok: database === "ok", verified: true, state: database,
      reason: database === "ok" ? null : `The database is ${database === "unconfigured" ? "not configured" : "not reachable"}. ${decisionsDown}` },
    { id: "auth", label: "Sign-in and sessions", critical: "decisions", configured: database !== "unconfigured", ok: database === "ok", verified: true, state: database === "ok" ? "ok" : "unavailable",
      reason: database === "ok" ? null : "Sign-in needs the database, which is not reachable." },
    { id: "policy_engine", label: "Policy engine", critical: "decisions", configured: true, ok: engine.ok, verified: true, state: engine.ok ? "ok" : "unavailable",
      reason: engine.ok ? null : `The Rust policy engine is not running. ${decisionsDown}` },
  ];
  // Mainnet execution is required only while mainnet is switched on.
  if (main.enabled) {
    checks.push(
      { id: "mainnet_cosigner", label: "Mainnet co-signer", critical: "execution", configured: mainSigner !== "not_configured", ok: mainSigner === "configured", ...cosigner(mainSigner, MAINNET),
        reason: cosignerReason(mainSigner, "Mainnet") },
      { id: "mainnet_bundler", label: "Mainnet bundler", critical: "execution", configured: mainnetBundler !== "not_configured", ok: mainnetBundler === "reachable", verified: true, state: mainnetBundler,
        reason: bundlerReason(mainnetBundler, "Mainnet") },
    );
  }
  checks.push(
    { id: "testnet_cosigner", label: "Testnet co-signer", critical: "none", configured: testSigner !== "not_configured", ok: testSigner === "configured", ...cosigner(testSigner, TESTNET),
      reason: cosignerReason(testSigner, "Testnet") },
    { id: "testnet_bundler", label: "Testnet bundler", critical: "none", configured: testnetBundler !== "not_configured", ok: testnetBundler === "reachable", verified: true, state: testnetBundler,
      reason: bundlerReason(testnetBundler, "Testnet") },
    { id: "agent_model", label: "PALISEC Agent model", critical: "none", configured: agentModel, ok: agentModel, verified: false, state: agentModel ? "configured" : "not_configured",
      reason: agentModel ? null : "The PALISEC Agent is off: no model key is configured." },
    { id: "webhooks", label: "Webhook signing", critical: "none", configured: webhooks, ok: webhooks, verified: false, state: webhooks ? "configured" : "not_configured",
      reason: webhooks ? null : "Webhooks cannot be created: the secrets key is not configured." },
  );

  const status = overallStatus(checks);
  return ok(
    {
      status,
      checked_at: new Date().toISOString(),
      components: {
        database,
        auth: database === "ok" ? "ok" : "unavailable",
        policy_engine: engine.ok ? "ok" : "unavailable",
        // Server-held co-signers, one per network; the enclave signer is a later upgrade.
        signer: test.signer ? "testnet_cosigner" : "not_configured",
        mainnet: main.enabled ? "enabled" : "switched_off",
        mainnet_signer: { configured: "mainnet_cosigner", not_configured: "not_configured", same_as_testnet: "same_as_testnet_key" }[mainSigner],
        mainnet_bundler: mainnetBundler,
        // Kept for compatibility: whether a testnet bundler is configured, not whether it answers.
        bundler: test.bundler ? "configured" : "not_configured",
        testnet_bundler: testnetBundler,
      },
      checks,
      schema_migration: schema,
      policy_engine: { implementation: "rust-wasm+reference", version: engine.version, source_hash: engine.source_hash.slice(0, 12) },
      // Whether optional features are configured on this deployment (never the values).
      features: { agent_model: agentModel, webhooks, mcp: true, smart_accounts: test.available || main.available },
      default_chain: defaultChain(),
      chains: Object.entries(CHAINS).map(([id, c]) => {
        const s = smartAccountsStatus(Number(id));
        return { chain_id: Number(id), name: c.name, testnet: c.testnet, enabled: c.enabled, smart_accounts: s.available };
      }),
    },
    { status: httpStatusFor(status) },
  );
});
