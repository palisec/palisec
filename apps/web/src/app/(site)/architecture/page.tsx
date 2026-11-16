import type { Metadata } from "next";
import { Note, PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = {
  title: "Architecture",
  description: "Request lifecycle, trust boundaries, TEE role, smart-account enforcement and chain submission for Palisec.",
  alternates: { canonical: "/architecture" },
};

const PLANES = [
  { name: "Control plane", items: ["Organizations and members", "API credentials", "Policy authoring and activation", "Human approvals", "Billing metadata"], note: "May be compromised. Cannot bypass on-chain authorization." },
  { name: "Enforcement plane", items: ["Policy evaluation", "Authoritative reservations", "Authorization decisions", "Protected signing"], note: "Security-critical. Deterministic, versioned, adversarially tested." },
  { name: "Chain plane", items: ["Smart-account validation", "Bundler submission", "RPC connectivity", "Receipts and reorgs"], note: "External dependencies validated; fails safely." },
  { name: "Observability plane", items: ["Redacted event delivery", "Audit records", "Aggregate analytics", "Alerting"], note: "Never the source of truth for authorization." },
];

const CORRECTIONS = [
  ["A dropped transaction is not an EVM revert.", "Pre-broadcast denials return a structured JSON-RPC error with a stable code and no transaction hash."],
  ["A gateway cannot secure a key it does not control.", "Protection requires a smart account with enforced validation or another cryptographic boundary."],
  ["PCR attestation is not enforced by an EVM contract.", "Contracts trust an explicitly registered signer. Attestation binds that signer to a measured build off chain."],
  ["ArbSys is not a universal fee oracle.", "Fees are estimated from Robinhood Chain's own RPC and fee model, once confirmed."],
];

const TRUST = [
  ["Agent / LLM", "Untrusted", "No independent unrestricted signing authority"],
  ["Public API", "Hostile input", "Authentication, validation, quotas, replay protection"],
  ["Control-plane server", "May be compromised", "Cannot bypass on-chain authorization"],
  ["Policy engine", "Security-critical", "Deterministic, versioned, adversarial tests"],
  ["TEE", "Trusted within hardware assumptions", "Attestation, measured builds, narrow interface"],
  ["State database", "May fail or go stale", "Atomic reservations, integrity checks, recovery"],
  ["RPC / bundler", "External", "Validate responses, reconcile receipts"],
  ["Human approver", "Authorized but fallible", "Exact transaction details, independent signature"],
  ["Smart account", "Enforced boundary", "Audited validation, bypass-resistance tests"],
];

function FlowDiagram() {
  const box = "border border-line-strong bg-ink px-4 py-3";
  return (
    <figure className="panel p-4 sm:p-8" aria-label="Execution architecture">
      <ol className="mx-auto flex max-w-[640px] flex-col items-stretch font-mono text-xs">
        <li className={box}><p className="text-fg">AI agent / application</p><p className="mt-1 text-muted">Proposed action · typed intent</p></li>
        <li aria-hidden className="mx-auto h-6 w-px bg-line-strong" />
        <li className={box}><p className="text-fg">SDK + API gateway</p><p className="mt-1 text-muted">Authentication · schema validation · replay protection</p></li>
        <li aria-hidden className="mx-auto h-6 w-px bg-line-strong" />
        <li className="border-2 border-fg bg-ink px-4 py-3"><p className="text-fg">Deterministic authorization boundary</p><p className="mt-1 text-muted">Policy engine · serialized budget state · simulation · signing authorization</p></li>
        <li aria-hidden className="mx-auto h-6 w-px bg-line-strong" />
        <li className="grid grid-cols-3 gap-2">
          <div className="border border-deny/60 px-3 py-3"><p className="text-deny">■ DENY</p><p className="mt-1 text-muted">No broadcast</p></div>
          <div className="border border-dashed border-review/60 px-3 py-3"><p className="text-review">◆ REVIEW</p><p className="mt-1 text-muted">Pending, unsigned</p></div>
          <div className="border border-allow/50 px-3 py-3"><p className="text-allow">→ ALLOW</p><p className="mt-1 text-muted">Authorized signing</p></div>
        </li>
        <li aria-hidden className="ml-auto mr-[16.6%] h-6 w-px bg-line-strong" />
        <li className={box}><p className="text-fg">Smart account · ERC-4337 validation</p><p className="mt-1 text-muted">On-chain enforcement · bundler · Robinhood Chain</p></li>
      </ol>
      <figcaption className="mx-auto mt-6 max-w-[640px] text-xs leading-relaxed text-muted">
        Intended flow. On-chain enforcement, signer authorization and bundler compatibility must be implemented and tested before
        bypass prevention is claimed.
      </figcaption>
    </figure>
  );
}

const FAILURES: [string, string][] = [
  ["Database, price or fee unavailable", "The request is denied (PS_STATE_001 / PS_FEE_001). Unknown is never treated as zero or allowed."],
  ["Rust engine and reference disagree", "Denied with PS_STATE_001, nothing reserved, and a policy_engine.fail_closed log line."],
  ["Model provider unavailable", "Agent runs fail with a clear error. Authorization, the SDKs, MCP and the console keep working."],
  ["Agent timeout or invalid tool output", "The tool call is recorded as an error; nothing is authorized or changed."],
  ["MCP endpoint unavailable", "The REST API and SDKs are independent and keep working."],
  ["Webhook receiver failing", "Three attempts with the same event ID, then marked failed for manual redelivery; decisions are unaffected."],
  ["Approval expired or policy version changed", "Approval is refused; the agent must request again and a person must sign again."],
  ["Emergency stop during agent activity", "Every new operation is denied at once; the agent can still explain, but cannot lift it."],
];

export default function ArchitecturePage() {
  return (
    <>
      <PageHeader
        compat="Schema 1.0 · pre-release · API on testnet · signing not deployed"
        eyebrow="Architecture"
        title="Decide off chain. Enforce on chain. Fail closed everywhere."
        lede="Four planes with explicit boundaries. Compromise of the control plane must not expose signing keys or permit unauthorized policy changes."
      />
      <Section index="01" label="Execution path">
        <FlowDiagram />
      </Section>
      <Section index="02" label="Planes">
        <div className="grid gap-px border border-line bg-line md:grid-cols-2 xl:grid-cols-4">
          {PLANES.map((p) => (
            <div key={p.name} className="flex flex-col bg-ink p-6">
              <h2 className="text-lg font-medium text-fg">{p.name}</h2>
              <ul className="mt-4 space-y-1.5 text-sm text-soft">
                {p.items.map((i) => <li key={i} className="border-l border-line-strong pl-3">{i}</li>)}
              </ul>
              <p className="mt-auto pt-6 text-xs leading-relaxed text-muted">{p.note}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section index="03" label="Corrections to common assumptions">
        <div className="divide-y divide-line border-y border-line">
          {CORRECTIONS.map(([a, b]) => (
            <div key={a} className="grid gap-2 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:gap-8">
              <p className="text-fg">{a}</p>
              <p className="text-sm leading-relaxed text-muted">{b}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section index="04" label="Trust boundaries">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr>{["Component", "Assumption", "Safeguard"].map((h) => <th key={h} className="label border-b border-line-strong py-2 pr-6 text-left font-normal">{h}</th>)}</tr>
            </thead>
            <tbody>
              {TRUST.map(([c, a, s]) => (
                <tr key={c} className="border-b border-line">
                  <td className="py-3 pr-6 text-fg">{c}</td>
                  <td className="py-3 pr-6 font-mono text-xs text-muted">{a}</td>
                  <td className="py-3 pr-6 text-soft">{s}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Note title="Stack">
          Next.js and TypeScript for the site and console; Rust for the policy engine; AWS Nitro Enclaves behind a documented TEE
          abstraction; Solidity with Foundry; PostgreSQL as the authoritative store; Redis for coordination with explicit
          consistency boundaries; ClickHouse for analytics only.
        </Note>
      </Section>
      <Section index="05" label="Native agent runtime" id="agent-runtime">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="space-y-4 text-[15.5px] leading-relaxed text-silver">
            <p>The PALISEC Agent is an isolated module of the API, never part of the policy engine. Runs are stored conversations; each request advances a run by a few model steps within a time budget, so no request stays open while a model reasons or a human decides.</p>
            <p>The model calls typed tools. The server resolves which tools the signed-in member may use (role × organization autonomy level × disabled tools), validates every input against its schema, scopes every query to the organization, and records each call with its evidence.</p>
            <p>Actions become requests; a member confirms them and they run through the same control-plane functions as the console, with the same role checks and audit.</p>
          </div>
          <pre className="panel overflow-x-auto p-5 font-mono text-[12px] leading-[1.9] text-soft">{`operator ─► run ─► model (Groq, OpenAI-compatible)
                     │ tool call (name, JSON)
                     ▼
            permission resolver ── refused ──► recorded
                     │ allowed
                     ▼
            tool (org-scoped, schema-checked, 10 s)
                     │ minimized, redacted output + evidence
                     ▼
            answer with [record:id] citations
                     │ action?
                     ▼
            action request ─► member confirms ─► control plane ─► audit`}</pre>
        </div>
      </Section>
      <Section index="06" label="External integrations" id="integrations">
        <div className="max-w-[760px] space-y-4 text-[15.5px] leading-relaxed text-silver">
          <p>External agents are untrusted callers. They authenticate with a scoped API key belonging to a registered agent, and reach the same functions through the REST API, the SDKs or the MCP server (stateless Streamable HTTP, one server instance per request). Every interface converges on the same evaluation, reservation and audit path.</p>
          <p>Webhooks are emitted after the response from the recorded change, signed with HMAC-SHA256, with one stable event ID per event and webhook, so retries cannot cause duplicate actions at a receiver that deduplicates.</p>
        </div>
      </Section>
      <Section index="07" label="Failure handling" id="failures">
        <dl className="divide-y divide-line border-y border-line">
          {FAILURES.map(([k, v]) => (
            <div key={k} className="grid gap-2 py-4 md:grid-cols-[300px_1fr]">
              <dt className="text-fg">{k}</dt>
              <dd className="text-sm leading-relaxed text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}
