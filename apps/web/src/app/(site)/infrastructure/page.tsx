import type { Metadata } from "next";
import Link from "next/link";
import { MaturityBadge, PageHeader, Section } from "@/components/ui";
import { CAPABILITIES, capability } from "@/lib/capabilities";

export const metadata: Metadata = {
  title: "Infrastructure",
  description: "PALISEC Core: deterministic authorization, policy model, spending controls, human approvals, protected signing, smart-account enforcement, execution lifecycle and audit.",
  alternates: { canonical: "/infrastructure" },
};

const PRODUCTS = [
  { n: "01", name: "Authorization engine", body: "Deterministic policy evaluation of every proposed transaction: account, target, method, value, fee, budget, loops and approvals.", cap: "engine" },
  { n: "02", name: "Protected signing service", body: "Policy-bound signing inside a TEE. The parent host cannot request a signature that skips evaluation.", cap: "enclave" },
  { n: "03", name: "On-chain account enforcement", body: "Smart-account validation that rejects operations without a valid PALISEC authorization.", cap: "account" },
  { n: "04", name: "Developer SDKs", body: "Typed clients for TypeScript (viem or ethers) and Python (web3.py), with no security logic of their own.", cap: "sdk-ts" },
  { n: "05", name: "Security control plane", body: "Policies, approvals, credentials, emergency stops and audit, enforced server-side for every role.", cap: "api" },
  { n: "06", name: "Developer platform", body: "This site and its documentation, the policy workbench, and the wallet-authenticated console.", cap: "console" },
];

const SECTIONS: { id: string; cap: string; title: string; body: string[]; link?: [string, string] }[] = [
  {
    id: "engine",
    cap: "engine",
    title: "Authorization engine",
    body: [
      "Every proposal is evaluated in a fixed order against authoritative state: active policy version, request schema, replay and deadline, emergency stop and agent status, chain and account, explicit deny, allowlisted target and selector, value and fee limits, price freshness, the rolling hourly budget, pending slots, loop cooldowns, and the approval threshold.",
      "The Rust engine (compiled to WebAssembly) and the TypeScript reference evaluator both run on every request. A decision counts only if they agree on every field; otherwise the request is denied with PS_STATE_001. A bug in either can deny, never allow.",
      "Outcomes are ALLOW, DENY or REQUIRES_HUMAN_SIGNATURE, each with a stable reason code. A missing, ambiguous or unavailable input is never treated as ALLOW.",
    ],
    link: ["/docs/errors", "Reason codes"],
  },
  {
    id: "policy",
    cap: "schema",
    title: "Policy model",
    body: [
      "One canonical, versioned document (schema 1.0) per protected account: limits, cooldowns, contract allowlist with selectors, explicit denylist, approval threshold, and a closed failure mode. Unknown fields are rejected so a typo can never disable a rule.",
      "Activation creates an immutable version bound to the hash of the draft the operator reviewed. Every decision records the exact version it used, so a later change never alters the meaning of an earlier authorization.",
    ],
    link: ["/docs/policies", "Policy reference"],
  },
  {
    id: "spending",
    cap: "reservations",
    title: "Spending controls",
    body: [
      "Amounts are integer wei and USD micros, never floats. Exposure is value plus the fee bound (gas limit times the live gas price), priced with a fresh ETH/USD quote; a stale or missing price denies.",
      "Reservations are written by one SQL function under a per-policy lock that re-checks budget, pending slots, replay and loops, so concurrent requests cannot overspend. Authorizations hold their budget until they expire, because nobody can prove they were not used.",
    ],
  },
  {
    id: "approvals",
    cap: "approvals",
    title: "Approval system",
    body: [
      "Above a threshold, or for methods the policy does not name, an operation is held. An approver signs EIP-712 typed data naming the exact request hash, account, target, value, calldata hash, policy version and expiry with their own wallet.",
      "Approval is refused if the agent was paused, the organization stopped, or the policy version changed since evaluation. A changed payload needs a new approval.",
    ],
  },
  {
    id: "signing",
    cap: "enclave",
    title: "Protected signing",
    body: [
      "Specified: a signer in an AWS Nitro Enclave whose key is released only to the measured image, signing only payloads bound to a recorded authorization, with no arbitrary-signing interface.",
      "Not deployed. Today PALISEC authorizes and records; the agent signs and sends its own transaction after an ALLOW.",
    ],
    link: ["/attestation", "Attestation"],
  },
  {
    id: "account",
    cap: "account",
    title: "Smart-account enforcement",
    body: [
      "A gateway cannot guard a key it does not hold. The protected path is an ERC-4337 account whose validation rejects any operation without a valid PALISEC authorization, so an agent that skips PALISEC cannot execute.",
      "Not deployed. Until it is, an agent key that bypasses PALISEC can still transact; this is stated wherever it matters.",
    ],
    link: ["/docs/account-abstraction", "Account abstraction"],
  },
  {
    id: "lifecycle",
    cap: "api",
    title: "Execution lifecycle",
    body: [
      "Propose, evaluate, reserve, approve when required, sign, validate on-chain, execute, reconcile. Each is a separate state: authorization is not signing, and signing is not execution.",
      "Requests are idempotent by request ID; a retry returns the original decision instead of a second one. Expiry is read, not written, so a stale authorization can never be used.",
    ],
    link: ["/architecture", "Lifecycle in depth"],
  },
  {
    id: "audit",
    cap: "api",
    title: "Auditability",
    body: [
      "Every decision, policy activation, approval, pause, stop, key change and PALISEC Agent action is an append-only audit event, written in the same statement as the change it records.",
      "Agent actions carry their run and tool-call IDs, so a recommendation can be traced to the operational action it led to.",
    ],
  },
];

const RULES = [
  ["Capital and budget", "Per-transaction value, fee ceiling, rolling hourly budget in USD, maximum pending operations."],
  ["Rate limits and loops", "Identical calldata and identical intent cooldowns; per-key and per-member rate limits."],
  ["Contracts and methods", "Allowed chain and account, default-deny targets, function selectors, verified-code requirement, explicit denylist."],
  ["Human authorization", "USD threshold and unknown-method review, signed by an approver's own wallet."],
  ["Emergency controls", "Pause an agent, revoke or rotate a key, disable a policy, stop all authorization in the organization."],
];

export default function InfrastructurePage() {
  return (
    <>
      <PageHeader
        eyebrow="PALISEC Core"
        title="The deterministic security infrastructure."
        lede="An agent may propose an action. PALISEC evaluates it against explicit policies, authoritative state and spending limits before anything executes. This is the layer every agent, including PALISEC's own, must pass through."
      />
      <Section index="01" label="Components">
        <div className="grid border-l border-t border-line sm:grid-cols-2 lg:grid-cols-3">
          {PRODUCTS.map((p) => {
            const c = CAPABILITIES.find((x) => x.id === p.cap)!;
            return (
              <article key={p.n} className="flex flex-col border-b border-r border-line p-6">
                <div className="mb-6 flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-dim">{p.n}</span>
                  <MaturityBadge maturity={c.maturity} />
                </div>
                <h2 className="text-lg font-medium text-fg">{p.name}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
              </article>
            );
          })}
        </div>
      </Section>
      {SECTIONS.map((s, i) => (
        <Section key={s.id} id={s.id} index={String(i + 2).padStart(2, "0")} label={s.title}>
          <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div>
              <h2 id={`${s.id}-title`} className="font-heading text-[26px] font-medium tracking-[-0.02em] text-mist">{s.title}</h2>
              <div className="mt-3">
                <MaturityBadge maturity={capability(s.cap).maturity} />
              </div>
            </div>
            <div className="max-w-[720px] space-y-4 text-[15.5px] leading-relaxed text-silver">
              {s.body.map((b) => (
                <p key={b}>{b}</p>
              ))}
              {s.link && (
                <Link href={s.link[0]} className="inline-block font-utility text-[12px] uppercase tracking-[0.1em] text-aqua underline-offset-4 hover:underline">
                  {s.link[1]} →
                </Link>
              )}
            </div>
          </div>
        </Section>
      ))}
      <Section index="10" label="Rule types · schema 1.0">
        <dl className="divide-y divide-line border-y border-line">
          {RULES.map(([k, v]) => (
            <div key={k} className="grid gap-2 py-5 md:grid-cols-[260px_1fr]">
              <dt className="text-fg">{k}</dt>
              <dd className="text-sm leading-relaxed text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}
