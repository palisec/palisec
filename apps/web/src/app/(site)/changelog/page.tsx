import type { Metadata } from "next";
import { Codes, PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = {
  title: "Changelog",
  description: "Versioned changes to Palisec.",
  alternates: { canonical: "/changelog" },
};

const ENTRIES = [
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
      "Without a configured database every state-dependent endpoint fails closed with RW_STATE_001.",
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
      "Added RW_REQUEST_001 for request schema failures.",
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
