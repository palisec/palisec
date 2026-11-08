import type { Metadata } from "next";
import { Codes, PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = {
  title: "Changelog",
  description: "Versioned changes to Palisec.",
  alternates: { canonical: "/changelog" },
};

const ENTRIES = [
  {
    version: "0.8.0",
    date: "2026-11-09",
    tag: "Pre-release · testnet",
    changes: [
      "The Rust policy engine is live. It runs as WebAssembly inside the API next to the TypeScript reference evaluator, and every decision needs both to agree on every field: decision, reason code, each check's wording and the next ledger state. Any difference, or an engine that cannot run, denies with PS_STATE_001 and reserves nothing.",
      "Parity is proven on every change: shared fixtures that cover ALLOW, human review and every DENY reason code are checked natively in Rust and in WebAssembly, and 6,000 seeded random cases compare the two implementations one by one. CI refuses an embedded engine that was not built from the current Rust source.",
      "GET /v1/health reports the engine's version and source hash.",
      "Hardening: every API response carries an X-Request-Id that matches the error body and the server logs; 429 responses send Retry-After; request bodies are limited by bytes as they stream and must be valid UTF-8 without NUL characters or deep nesting, so bad input is a 400 instead of a storage error; all API-key failures share one message.",
      "A hostile-input suite (malformed, oversized, forged and replayed requests) runs in CI against Postgres on every change, and tagged releases are published only after every check passes.",
      "Icons replace text on icon-style controls: menu, close, copy, refresh, remove, sign out, reset and replay. Each keeps an accessible name and a tooltip.",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-11-09",
    tag: "Pre-release · testnet",
    changes: [
      "Python SDK palisec 0.1.0, installed with pip from https://palisec.tech/sdk/palisec-0.1.0-py3-none-any.whl: async, typed, no third-party dependencies. authorize, dry-run evaluate, wait_for_approval, cancel and send_transaction, with the same semantics as the TypeScript SDK.",
      "palisec.web3.Web3Sender sends with web3.py: it checks the RPC's chain, signs locally and pays the gas limit Palisec bounded the fee on.",
      "TypeScript SDK 0.2.0: fromEthers adapts an ethers v6 signer; a wallet on another chain is refused before sending.",
      "Both SDKs run against the live API in CI on every change. The served Python wheel is rebuilt from source in CI and must match byte for byte in content.",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-11-09",
    tag: "Pre-release · testnet",
    changes: [
      "TypeScript SDK @palisec/sdk 0.1.0, installed from https://palisec.tech/sdk/palisec-sdk-0.1.0.tgz: authorize, dry-run evaluate, waitForApproval, cancel, and sendTransaction, which sends with your viem wallet only on ALLOW and refuses a wallet that is not the agent's account.",
      "Typed errors with stable codes, automatic idempotency keys, timeouts, and retries only on calls that are safe to repeat. Log events never contain API keys, bodies or calldata.",
      "The SDK is tested against the live API in CI on every change, alongside the API end-to-end suite.",
      "The service now runs only at palisec.tech.",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-11-04",
    tag: "Pre-release · testnet",
    changes: [
      "The console requires wallet sign-in: opening any console page without a session leads to /login and back to that page afterwards. palisec.tech itself stays the public overview, and the console logo returns to it.",
      "The console shows real data only. The example-data simulation is gone; an expired session returns you to sign-in and an unreachable control plane is shown as such.",
      "Dashboard: 24-hour outcome chart (UTC, hourly), policy status and last activation, connectivity, and recent security events that open their exact record.",
      "Policy editor split into a rule builder and the generated policy, with test cases that evaluate the unsaved draft against live fee and price inputs.",
      "Agent detail shows owner, budget and rate limits and recent operations; operations and audit gain agent, request ID and time-range filters and deep links; approvals can be sorted.",
      "Sign-in returns you to the page you asked for, accepting only console paths. Console changes are rate-limited per member.",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-11-04",
    tag: "Pre-release · testnet",
    changes: [
      "Authorization API on Robinhood Chain Testnet (46630): POST /v1/operations records each decision with its budget reservation; POST /v1/authorizations/evaluate is a dry run. Idempotency-Key, request_id replay protection and loop cooldowns.",
      "Budget reservations are serialized per policy in Postgres: one SQL function re-checks budget, pending slots, replay and loop state, so concurrent requests cannot overspend. Tested with 30 simultaneous requests for one slot.",
      "Agents bound to a smart account and a policy, with per-agent API keys shown once and stored as SHA-256 hashes. Pause, resume and revoke.",
      "Policies: drafts validated against schema 1.0, activation bound to the reviewed draft's hash, immutable versions, disable.",
      "Human approvals signed with EIP-712 over the exact operation and policy version, re-checked against pause, emergency stop and policy changes at approval time.",
      "Organization emergency stop (operators engage, owners lift), members and roles enforced server-side, append-only audit API.",
      "Fee bound from the testnet RPC gas price; USD conversion from Coinbase with a Kraken fallback. Any missing input fails closed.",
      "The console reads live data when you are signed in; visitors keep the simulation. API reference and OpenAPI 3.1 at /api/v1/openapi.json.",
      "Not in this release: signing, bundler submission, receipt reconciliation and the on-chain account module.",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-10-29",
    tag: "Pre-release",
    changes: [
      "Control-plane foundation: Postgres schema with an append-only audit log, applied by versioned migrations.",
      "Wallet sign-in (SIWE, EIP-4361) at /login: server-issued one-time challenges bound to the domain, EOA and ERC-1271 signature verification, HttpOnly sessions with revocation and an Origin check on state changes.",
      "First sign-in creates an organization with the signer as owner. GET /v1/health reports which components are reachable and which are not deployed.",
      "Without a configured database every state-dependent endpoint fails closed with PS_STATE_001.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-10-23",
    tag: "Pre-release",
    changes: [
      "Developer console as a simulation workspace: dashboard, agents, policy editor, operations, approval queue, audit, keys and circuit breakers, and organization settings.",
      "Console decisions come from the canonical evaluator and validator; data stays in the browser and nothing is signed or submitted.",
      "Policy reference gains version migration; the errors guide gains recovery procedures, RPC outages and debugging; the security model gains incident response.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-10-21",
    tag: "Pre-release",
    changes: [
      "Canonical policy schema 1.0 with JSON Schema, TypeScript types and validation.",
      "Deterministic reference evaluator with fixed evaluation order and stable reason codes.",
      "Browser policy workbench running the reference evaluator on example data.",
      "Public site and documentation, with maturity labels on every capability.",
      "Added PS_REQUEST_001 for request schema failures.",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <>
      <PageHeader eyebrow="Changelog" title="Changes, by version." />
      <Section>
        <ol className="space-y-12">
          {ENTRIES.map((e) => (
            <li key={e.version} className="grid gap-4 md:grid-cols-[200px_1fr]">
              <div>
                <p className="font-mono text-lg text-fg">{e.version}</p>
                <p className="label mt-1">{e.date} · {e.tag}</p>
              </div>
              <ul className="space-y-2 border-l border-line pl-6 text-sm leading-relaxed text-soft">
                {e.changes.map((c) => <li key={c}><Codes text={c} /></li>)}
              </ul>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
