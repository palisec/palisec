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
  { id: "engine", name: "Rust policy engine", maturity: "service", note: "Runs as WebAssembly in the API next to the TypeScript reference evaluator. Every decision needs both to agree on every field; any difference, or an engine that cannot run, denies with PS_STATE_001. Parity is tested on shared fixtures and 6,000 random cases on every change." },
  { id: "reservations", name: "Atomic budget reservations", maturity: "service", note: "Postgres ledger serialized per policy: one SQL function re-checks budget, pending slots, replay and loop state before recording. Testnet only." },
  { id: "enclave", name: "TEE-backed signing (AWS Nitro)", maturity: "specified", note: "Policy-bound signing with no arbitrary-signing interface." },
  { id: "account", name: "ERC-4337 validation module", maturity: "specified", note: "On-chain rejection of operations without a valid Palisec authorization. Until it ships, an agent key that skips Palisec can still transact." },
  { id: "identity", name: "Wallet sign-in and sessions", maturity: "service", note: "SIWE challenge and verify, HttpOnly sessions, organizations, members and roles enforced server-side." },
  { id: "api", name: "Authorization API", maturity: "service", note: "Agents, API keys, policy versions, evaluate, operations with idempotency, approvals and audit. Testnet (46630) only. Decisions are recorded; nothing is signed or broadcast." },
  { id: "approvals", name: "Human approvals", maturity: "service", note: "Approvers sign EIP-712 data bound to the exact operation and policy version with their own wallet." },
  { id: "sdk-ts", name: "TypeScript SDK (viem, ethers)", maturity: "service", note: "@palisec/sdk 0.3.0, installed from palisec.tech: typed decisions and errors, idempotent retries, approval waiting, sends with viem or ethers only on ALLOW." },
  { id: "sdk-py", name: "Python SDK", maturity: "service", note: "palisec 0.2.0, installed from palisec.tech: async, no dependencies, same semantics as the TypeScript SDK, web3.py adapter. Tested against the live API." },
  { id: "agent", name: "PALISEC Agent (native)", maturity: "service", note: "Security intelligence, policy engineering and operations assistance over real records, through 30 server-checked tools. Cannot authorize, approve, sign or activate: actions are requests a member confirms. Model: any OpenAI-compatible provider (Groq free tier by default); investigations also run without a model." },
  { id: "security-events", name: "Security events", maturity: "service", note: "Deterministic detectors over the authoritative records (repeated denials, replays, unapproved contracts and methods, budget thresholds, unfamiliar targets, rejections, pauses, emergency stops), each with evidence." },
  { id: "mcp", name: "MCP server", maturity: "service", note: "Official MCP TypeScript SDK, Streamable HTTP at /api/mcp. API key with the mcp scope; each tool checks its own scope; same authorization path as REST. No activation, approval or signing tools." },
  { id: "integrations", name: "Integrations and scoped keys", maturity: "service", note: "Registered agents with least-privilege key scopes, atomic rotation, revocation, framework metadata and activity." },
  { id: "webhooks", name: "Webhooks", maturity: "service", note: "HMAC-SHA256 signed events with stable IDs, retries and redelivery; public HTTPS endpoints only. Verification helpers in both SDKs." },
  { id: "framework-adapters", name: "Framework adapters (OpenAI Agents SDK, LangGraph, Vercel AI SDK)", maturity: "planned", note: "Today any framework integrates through the SDKs (wrap sendTransaction as a tool) or the MCP server; dedicated tested adapters come later." },
  { id: "console", name: "Developer console", maturity: "service", note: "Wallet sign-in, then agents, policies with a rule builder and test cases, approvals, audit and emergency controls on testnet. Real data only." },
];

export const capability = (id: string) => CAPABILITIES.find((c) => c.id === id)!;
