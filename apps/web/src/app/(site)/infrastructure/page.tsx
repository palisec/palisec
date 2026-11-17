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
      "Not deployed yet. Today PALISEC co-signs allowed operations for smart accounts with a server-held key per network (a separate key for mainnet). The co-signer cannot move funds alone; the enclave will also protect it from anyone with server access.",
    ],
    link: ["/attestation", "Attestation"],
  },
  {
    id: "account",
    cap: "account",
    title: "Smart-account enforcement",
    body: [
      "A gateway cannot guard a key it does not hold. The protected path is a Safe smart account (ERC-4337) whose threshold is 2 and whose owners include PALISEC's co-signer, so an agent that skips PALISEC cannot execute.",
      "Live on Robinhood Chain mainnet and testnet: PALISEC co-signs only an allowed or approved operation, for that exact payload and until its authorization expires, and submits it through a bundler. Agents that send from a plain key are still not enforced on chain.",
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
      <Section label="Components" intro="Six parts, one boundary. Status comes from the live capability list, so nothing unbuilt is presented as shipped.">
        <ul className="border-t border-line">
          {PRODUCTS.map((p) => {
            const c = CAPABILITIES.find((x) => x.id === p.cap)!;
            return (
              <li key={p.n} className="grid gap-x-8 gap-y-2 border-b border-line py-6 md:grid-cols-[280px_minmax(0,1fr)_190px] md:items-center [&>span]:md:justify-self-end">
                <h3 className="text-[19px] font-medium text-mist">{p.name}</h3>
                <p className="text-[15px] leading-relaxed text-silver">{p.body}</p>
                <MaturityBadge maturity={c.maturity} />
              </li>
            );
          })}
        </ul>
      </Section>
      {SECTIONS.map((s, i) => (
        <Section key={s.id} id={s.id} label={s.title} className={i % 2 ? "border-y border-line bg-deep/40" : ""}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <MaturityBadge maturity={capability(s.cap).maturity} />
            {s.link && (
              <Link href={s.link[0]} className="inline-flex items-center gap-1.5 text-[15px] font-medium text-aqua underline-offset-4 hover:underline">
                {s.link[1]} <span aria-hidden>&rarr;</span>
              </Link>
            )}
          </div>
          <div className="mt-6 max-w-[68ch] space-y-4 text-[17px] leading-relaxed text-silver">
            {s.body.map((b) => (
              <p key={b}>{b}</p>
            ))}
          </div>
        </Section>
      ))}
      <Section label="Rule types in schema 1.0">
        <dl className="divide-y divide-line border-y border-line">
          {RULES.map(([k, v]) => (
            <div key={k} className="grid gap-2 py-5 md:grid-cols-[260px_1fr]">
              <dt className="text-[16px] font-medium text-mist">{k}</dt>
              <dd className="text-[15px] leading-relaxed text-silver">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}
