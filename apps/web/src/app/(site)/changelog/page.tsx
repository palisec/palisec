import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import { Codes, PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = {
  title: "Changelog",
  description: "Versioned changes to Palisec.",
  alternates: { canonical: "/changelog" }, openGraph: pageOpenGraph("/changelog"),
};

const ENTRIES = [
  {
    version: "1.0.2",
    date: "2026-11-18",
    tag: "SDK republish",
    changes: [
      "TypeScript SDK 0.6.2 and Python SDK 0.4.1: same code as 0.6.0 and 0.4.0, republished from the Palisec company accounts with package links pointing to palisec.tech. Earlier registry versions are withdrawn from npm and PyPI; their palisec.tech/sdk files keep working.",
    ],
  },
  {
    version: "1.0.1",
    date: "2026-11-18",
    tag: "SDKs on npm and PyPI",
    changes: [
      "SDKs on the public registries: npm install @palisec/sdk and pip install palisec. The palisec.tech/sdk links keep working, including every earlier version (TypeScript 0.1.0 to 0.5.0 rebuilt from their release commits; Python 0.1.0 restored).",
      "TypeScript SDK 0.6.0 bundles the policy schema code and types, and exports the local evaluator as @palisec/sdk/policy.",
      "Link previews: every page has its own og:url and a preview image. The sitemap lists every public page; /favicon.ico and a /docs/sdk redirect added.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-11-18",
    tag: "Mainnet launch",
    changes: [
      "Robinhood Chain mainnet is the primary network. Terms of Service updated for real funds, custody and the PALISEC token.",
      "Robinhood Chain mainnet (4663) alongside testnet (46630). The same Safe and ERC-4337 contracts, with identical code, on both; PALISEC co-signs with a separate key on each network, and a signature for one network is never valid on the other.",
      "Mainnet agents get ps_live_ keys and testnet agents ps_test_ keys. GET /v1/health lists the enabled networks, the default network and whether smart accounts are available on each.",
      "Console: a network switch in the top bar (mainnet in the caution colour). Agents, policies, smart accounts and approvals follow it, and the wallet is moved to the right network before anything is signed.",
      "SDKs: TypeScript 0.6.0 and Python 0.4.0 take the network from the key and refuse a mismatched chain.",
      "Header: one-click copy of the PALISEC token contract address.",
    ],
  },
  {
    version: "0.10.0",
    date: "2026-11-17",
    tag: "testnet · on-chain enforcement",
    changes: [
      "Smart accounts: a Safe (Safe 4337 module, EntryPoint v0.7) with a threshold of 2 and PALISEC's co-signer as an owner. PALISEC co-signs only an allowed or approved operation, for exactly that payload and until its authorization expires, and submits it through an ERC-4337 bundler. The agent's key alone cannot move funds; an organization recovery owner can.",
      "API: POST /v1/operations/{id}/user-operation and /submit, GET /v1/operations/{id}/execution, GET /v1/smart-accounts and /v1/smart-accounts/{address}. New webhook events operation.submitted and operation.executed.",
      "Console: Smart accounts page to create an account with your wallet and see which agents are enforced on chain.",
      "SDKs: TypeScript 0.5.0 executeWithSmartAccount, Python 0.3.0 execute_with_smart_account.",
      "Site: redesigned with full-width layouts, line icons and tool logos, a new architecture page, and a Concepts page in the docs.",
    ],
  },
  {
    version: "0.9.1",
    date: "2026-11-16",
    tag: "testnet",
    changes: [
      "New PALISEC logo: a hexagonal P around the protected cube, in the site, console and browser icon.",
      "TypeScript SDK 0.4.0: createPalisecTools gives the OpenAI Agents SDK, the Vercel AI SDK and LangGraph the same framework-neutral tools (evaluate, send only on ALLOW, read an operation, explain a reason code).",
      "PALISEC Agent: free-tier rate limits are waited out and retried; a run that still hits the limit pauses with Continue instead of failing.",
      "Console: Usage page with requests and decisions per agent and key, and a version comparison in the policy editor.",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-11-16",
    tag: "testnet · PALISEC 2.0",
    changes: [
      "PALISEC Agent: a native security operator in the console with 30 server-checked tools for investigation, policy engineering (draft, validate, simulate including history replay, compare, explain) and operations. It cannot authorize, approve, sign or activate; actions are requests a member confirms. Autonomy levels 0-2, evidence-linked answers, unverified citations flagged. Any OpenAI-compatible model; Groq free tier by default.",
      "PALISEC Connect: least-privilege API key scopes (existing keys keep all of them), atomic key rotation, integration activity, and endpoints for a key's own identity, policy version, operations and audit trail.",
      "MCP server at /api/mcp (official MCP SDK, Streamable HTTP) with per-tool scope checks and the same authorization path as REST.",
      "Webhooks: HMAC-SHA256 signed events with stable IDs, retries, redelivery and an SSRF guard. verifyWebhook in both SDKs.",
      "Security events: deterministic detectors (repeated denials, replays, unapproved contracts and selectors, budget thresholds, unfamiliar targets, rejections, pauses, emergency stops) with evidence and webhooks.",
      "SDKs: TypeScript 0.3.0 and Python 0.2.0 add whoAmI, policy and audit reads, own operations, and a transactions namespace. Existing methods unchanged.",
      "Website redesigned around the agent economy: Infrastructure, PALISEC Agent, Integrations and Developers pages; /product now redirects to /infrastructure. Decision states use green (allow), crimson (deny) and amber (approval).",
      "New end-to-end suites in CI: Connect (59 checks, official MCP client) and Agent (48 checks with a scripted model, including prompt injection, forged tools, tenant isolation and provider outage).",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-11-09",
    tag: "testnet",
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
    tag: "testnet",
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
    tag: "testnet",
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
    tag: "testnet",
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
    tag: "testnet",
    changes: [
      "Authorization API on Robinhood Chain Testnet (46630): POST /v1/operations records each decision with its budget reservation; POST /v1/authorizations/evaluate is a dry run. Idempotency-Key, request_id replay protection and loop cooldowns.",
      "Budget reservations are serialized per policy in Postgres: one SQL function re-checks budget, pending slots, replay and loop state, so concurrent requests cannot overspend. Tested with 30 simultaneous requests for one slot.",
      "Agents bound to a smart account and a policy, with per-agent API keys shown once and stored as SHA-256 hashes. Pause, resume and revoke.",
      "Policies: drafts validated against schema 1.0, activation bound to the reviewed draft's hash, immutable versions, disable.",
      "Human approvals signed with EIP-712 over the exact operation and policy version, re-checked against pause, emergency stop and policy changes at approval time.",
      "Organization emergency stop (operators engage, owners lift), members and roles enforced server-side, append-only audit API.",
      "Fee bound from the testnet RPC gas price; USD conversion from Coinbase with a Kraken fallback. Any missing input fails closed.",
      "The console reads live data when you are signed in; visitors keep the simulation. API reference and OpenAPI 3.1 at /api/v1/openapi.json.",
      "Signing, bundler submission and the on-chain account module followed in 0.10.0.",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-10-29",
    tag: "Foundations",
    changes: [
      "Control-plane foundation: Postgres schema with an append-only audit log, applied by versioned migrations.",
      "Wallet sign-in (SIWE, EIP-4361) at /login: server-issued one-time challenges bound to the domain, EOA and ERC-1271 signature verification, HttpOnly sessions with revocation and an Origin check on state changes.",
      "First sign-in creates an organization with the signer as owner. GET /v1/health reports which components are reachable.",
      "Without a configured database every state-dependent endpoint fails closed with PS_STATE_001.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-10-23",
    tag: "Foundations",
    changes: [
      "Developer console as a simulation workspace: dashboard, agents, policy editor, operations, approval queue, audit, keys and circuit breakers, and organization settings.",
      "Console decisions come from the canonical evaluator and validator; data stays in the browser and nothing is signed or submitted.",
      "Policy reference gains version migration; the errors guide gains recovery procedures, RPC outages and debugging; the security model gains incident response.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-10-21",
    tag: "Foundations",
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
