/**
 * Single source of truth for what exists today. Every page that describes a capability
 * reads its status from here, so the site cannot drift into claiming unbuilt features.
 */
export type Maturity = "local" | "service" | "specified" | "planned";

export const MATURITY_LABEL: Record<Maturity, string> = {
  local: "Available · local simulation",
  service: "Built · control plane",
  specified: "Specified · on the roadmap",
  planned: "Planned",
};

/** The one-word form shown on badges; the full label stays available as the accessible name. */
export const MATURITY_SHORT: Record<Maturity, string> = {
  local: "In browser",
  service: "Built",
  specified: "Specified",
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
  { id: "engine", name: "Rust policy engine", maturity: "service", note: "Runs as WebAssembly in the API next to the TypeScript reference evaluator. Every decision needs both to agree on every field; any difference, or an engine that cannot run, denies with PS_STATE_001. Parity is tested on shared fixtures and 6,000 random cases on every change." },
  { id: "reservations", name: "Atomic budget reservations", maturity: "service", note: "Postgres ledger serialized per policy: one SQL function re-checks budget, pending slots, replay and loop state before recording." },
  { id: "enclave", name: "TEE-backed signing (AWS Nitro)", maturity: "specified", note: "Policy-bound signing with no arbitrary-signing interface." },
  { id: "account", name: "Smart-account enforcement (Safe + 4337 module)", maturity: "service", note: "Mainnet and testnet: a Safe whose threshold is 2 and whose owners include PALISEC's co-signer, the agent's key and an organization recovery owner. PALISEC co-signs only an allowed or approved operation, for exactly that payload and until its authorization expires, and submits it through an ERC-4337 bundler. The agent's key alone cannot move funds. The co-signer is a server-held testnet key; the mainnet signer belongs in the enclave." },
  { id: "identity", name: "Wallet sign-in and sessions", maturity: "service", note: "SIWE challenge and verify, HttpOnly sessions, organizations, members and roles enforced server-side." },
  { id: "api", name: "Authorization API", maturity: "service", note: "Agents, API keys, policy versions, evaluate, operations with idempotency, approvals and audit. Mainnet (4663) with ps_live_ keys and testnet (46630) with ps_test_ keys. Allowed operations can be executed through a PALISEC smart account." },
  { id: "approvals", name: "Human approvals", maturity: "service", note: "Approvers sign EIP-712 data bound to the exact operation and policy version with their own wallet." },
  { id: "sdk-ts", name: "TypeScript SDK (viem, ethers)", maturity: "service", note: "@palisec/sdk 0.6.2 on npm (also served from palisec.tech): typed decisions and errors, idempotent retries, approval waiting, sending with viem or ethers only on ALLOW, and executeWithSmartAccount for on-chain enforcement." },
  { id: "sdk-py", name: "Python SDK", maturity: "service", note: "palisec 0.4.1 on PyPI (also served from palisec.tech): async, no dependencies, same semantics as the TypeScript SDK, a web3.py adapter and execute_with_smart_account. Tested against the live API." },
  { id: "agent", name: "PALISEC Agent (native)", maturity: "service", note: "Security intelligence, policy engineering and operations assistance over real records, through 30 server-checked tools. Cannot authorize, approve, sign or activate: actions are requests a member confirms. Model: any OpenAI-compatible provider (Groq free tier by default); investigations also run without a model." },
  { id: "security-events", name: "Security events", maturity: "service", note: "Deterministic detectors over the authoritative records (repeated denials, replays, unapproved contracts and methods, budget thresholds, unfamiliar targets, rejections, pauses, emergency stops), each with evidence." },
  { id: "mcp", name: "MCP server", maturity: "service", note: "Official MCP TypeScript SDK, Streamable HTTP at /api/mcp. API key with the mcp scope; each tool checks its own scope; same authorization path as REST. No activation, approval or signing tools." },
  { id: "integrations", name: "Integrations and scoped keys", maturity: "service", note: "Registered agents with least-privilege key scopes, atomic rotation, revocation, framework metadata and activity." },
  { id: "webhooks", name: "Webhooks", maturity: "service", note: "HMAC-SHA256 signed events with stable IDs, retries and redelivery; public HTTPS endpoints only. Verification helpers in both SDKs." },
  { id: "framework-adapters", name: "Framework tools (OpenAI Agents SDK, LangGraph, Vercel AI SDK)", maturity: "service", note: "createPalisecTools in @palisec/sdk 0.4.0 and later: framework-neutral JSON-schema tools (evaluate, send only on ALLOW, read, explain) accepted by each framework's tool API. Unit-tested; MCP-capable frameworks can use the MCP server." },
  { id: "console", name: "Developer console", maturity: "service", note: "Wallet sign-in, then agents, policies with a rule builder and test cases, approvals, audit and emergency controls on testnet. Real data only." },
];

export const capability = (id: string) => CAPABILITIES.find((c) => c.id === id)!;
