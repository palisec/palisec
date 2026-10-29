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
  { id: "engine", name: "Rust policy engine", maturity: "specified", note: "Production evaluator implementing the same schema and reason codes." },
  { id: "reservations", name: "Atomic budget reservations", maturity: "specified", note: "Serialized ledger keyed by account, agent and window." },
  { id: "enclave", name: "TEE-backed signing (AWS Nitro)", maturity: "specified", note: "Policy-bound signing with no arbitrary-signing interface." },
  { id: "account", name: "ERC-4337 validation module", maturity: "specified", note: "On-chain rejection of operations without a valid Palisec authorization." },
  { id: "identity", name: "Wallet sign-in and sessions", maturity: "service", note: "SIWE challenge and verify, HttpOnly sessions, organizations and roles. Live once the deployment is connected to Postgres." },
  { id: "api", name: "Authorization API", maturity: "specified", note: "OpenAPI 3.1 contract specified; evaluation and operation endpoints are not published yet." },
  { id: "sdk-ts", name: "TypeScript SDK (viem)", maturity: "specified", note: "@palisec/sdk. Not published." },
  { id: "sdk-py", name: "Python SDK", maturity: "planned", note: "Published only once its semantics match the canonical API." },
  { id: "console", name: "Developer console", maturity: "local", note: "Runs as a simulation workspace in the browser. The authenticated console needs the control plane, which is not deployed." },
];

export const capability = (id: string) => CAPABILITIES.find((c) => c.id === id)!;
