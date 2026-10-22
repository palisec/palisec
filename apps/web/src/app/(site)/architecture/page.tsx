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

export default function ArchitecturePage() {
  return (
    <>
      <PageHeader
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
    </>
  );
}
