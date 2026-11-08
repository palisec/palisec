/**
 * Single source of truth for what exists today. Every page that describes a capability
 * reads its status from here, so the site cannot drift into claiming unbuilt features.
 */
export type Maturity = "local" | "service" | "specified" | "planned";

export const MATURITY_LABEL: Record<Maturity, string> = {
  local: "Available · local simulation",
  service: "Built · control plane",
  specified: "Specified · not deployed",
  planned: "Planned",
};

export interface Capability {
  id: string;
  name: string;
  maturity: Maturity;
  note: string;
}

export const CAPABILITIES: Capability[] = [
  { id: "schema", name: "Canonical policy schema 1.0", maturity: "local", note: "JSON Schema and TypeScript types; validated in the browser workbench." },
  { id: "simulator", name: "Deterministic local simulator", maturity: "local", note: "Runs the evaluation order on example data. Never signs or broadcasts." },
  { id: "engine", name: "Rust policy engine", maturity: "specified", note: "Production evaluator implementing the same schema and reason codes. Until it ships, the API runs the TypeScript reference evaluator on the server." },
  { id: "reservations", name: "Atomic budget reservations", maturity: "service", note: "Postgres ledger serialized per policy: one SQL function re-checks budget, pending slots, replay and loop state before recording. Testnet only." },
  { id: "enclave", name: "TEE-backed signing (AWS Nitro)", maturity: "specified", note: "Policy-bound signing with no arbitrary-signing interface." },
  { id: "account", name: "ERC-4337 validation module", maturity: "specified", note: "On-chain rejection of operations without a valid Palisec authorization. Until it ships, an agent key that skips Palisec can still transact." },
  { id: "identity", name: "Wallet sign-in and sessions", maturity: "service", note: "SIWE challenge and verify, HttpOnly sessions, organizations, members and roles enforced server-side." },
  { id: "api", name: "Authorization API", maturity: "service", note: "Agents, API keys, policy versions, evaluate, operations with idempotency, approvals and audit. Testnet (46630) only. Decisions are recorded; nothing is signed or broadcast." },
  { id: "approvals", name: "Human approvals", maturity: "service", note: "Approvers sign EIP-712 data bound to the exact operation and policy version with their own wallet." },
  { id: "sdk-ts", name: "TypeScript SDK (viem)", maturity: "service", note: "@palisec/sdk 0.1.0, installed from palisec.tech: typed decisions and errors, idempotent retries, approval waiting, sends with viem only on ALLOW." },
  { id: "sdk-py", name: "Python SDK", maturity: "planned", note: "Published only once its semantics match the canonical API." },
  { id: "console", name: "Developer console", maturity: "service", note: "Wallet sign-in, then agents, policies with a rule builder and test cases, approvals, audit and emergency controls on testnet. Real data only." },
];

export const capability = (id: string) => CAPABILITIES.find((c) => c.id === id)!;
