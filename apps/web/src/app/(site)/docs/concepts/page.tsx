import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { DocArticle } from "@/components/doc";
import {
  ActivityIcon,
  AgentIcon,
  BanIcon,
  CheckCircleIcon,
  ClockIcon,
  CodeIcon,
  FileCheckIcon,
  GaugeIcon,
  HandIcon,
  KeyIcon,
  RepeatIcon,
  ShieldCheckIcon,
  SlidersIcon,
  StopIcon,
  UserCheckIcon,
  WalletIcon,
} from "@/components/icons";
import { Note } from "@/components/ui";

export const metadata: Metadata = {
  title: "Concepts",
  description: "The core ideas in PALISEC: agents, policies, operations, decisions, reservations, approvals, authorizations and audit events.",
  alternates: { canonical: "/docs/concepts" },
};

const TERMS: { icon: ReactNode; term: string; def: string; see: [string, string] }[] = [
  { icon: <WalletIcon size={18} />, term: "Protected account", def: "The address whose transactions PALISEC governs. Today it is the agent's own account; with enforcement it becomes a smart account.", see: ["/docs/account-abstraction", "Smart accounts"] },
  { icon: <AgentIcon size={18} />, term: "Agent", def: "A registered caller bound to one account, one chain and one policy. It can be paused or revoked without touching the policy.", see: ["/docs/integrations", "Keys"] },
  { icon: <KeyIcon size={18} />, term: "Scoped key", def: "An API key for one agent, limited to named scopes such as operations:write or mcp. Shown once, stored only as a hash.", see: ["/docs/integrations", "Keys"] },
  { icon: <SlidersIcon size={18} />, term: "Policy", def: "One JSON document per account: limits, cooldowns, allowed contracts and methods, deny rules and the approval threshold.", see: ["/docs/policies", "Policy schema"] },
  { icon: <FileCheckIcon size={18} />, term: "Policy version", def: "An immutable, hash-bound copy of a policy. Every decision records the version it used, so later edits never change history.", see: ["/docs/policies", "Policy schema"] },
  { icon: <CodeIcon size={18} />, term: "Operation", def: "One proposed transaction and its outcome. The request ID makes it idempotent: sending it again returns the same answer.", see: ["/docs/api", "REST API"] },
  { icon: <ShieldCheckIcon size={18} />, term: "Decision", def: "ALLOW, DENY or REQUIRES_HUMAN_SIGNATURE, with a stable reason code and the result of every check.", see: ["/docs/errors", "Errors"] },
  { icon: <GaugeIcon size={18} />, term: "Reservation", def: "The budget an allowed or pending operation holds. Taken atomically, so two requests at once can never overspend.", see: ["/architecture#engine", "Architecture"] },
  { icon: <HandIcon size={18} />, term: "Approval", def: "An EIP-712 signature by a member's own wallet over the exact operation and policy version. It expires.", see: ["/docs/account-abstraction", "Smart accounts"] },
  { icon: <CheckCircleIcon size={18} />, term: "Authorization", def: "Proof that PALISEC allowed one exact payload on one chain under one policy version, valid for a short window.", see: ["/docs/account-abstraction", "Smart accounts"] },
  { icon: <ActivityIcon size={18} />, term: "Audit event", def: "An append-only record of every decision and change, written in the same statement as the change itself.", see: ["/security", "Security model"] },
  { icon: <StopIcon size={18} />, term: "Emergency stop", def: "One switch that denies every new operation in the organization until a member lifts it.", see: ["/docs/errors", "Errors"] },
];

/** Operation states as stored in the ledger (operations.state). */
function StateChart() {
  const pill = "inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[12.5px] ring-1 ring-inset";
  const arrow = <span aria-hidden className="h-px w-6 shrink-0 bg-line-strong sm:w-10" />;
  return (
    <figure className="not-prose my-8 rounded-[14px] border border-line-strong bg-deep/60 p-5" aria-label="Operation states">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`${pill} text-mist ring-line-strong`}><CodeIcon size={14} />request</span>
          {arrow}
          <span className={`${pill} text-allow ring-allow/45`}><CheckCircleIcon size={14} />authorized</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:pl-[118px]">
          {arrow}
          <span className={`${pill} text-deny ring-deny/45`}><BanIcon size={14} />denied</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:pl-[118px]">
          {arrow}
          <span className={`${pill} text-review ring-review/45`}><HandIcon size={14} />pending_approval</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-l border-line-strong sm:ml-[200px] sm:pl-4">
          <span className={`${pill} text-allow ring-allow/45`}><UserCheckIcon size={14} />approved</span>
          <span className={`${pill} text-deny ring-deny/45`}><BanIcon size={14} />rejected</span>
          <span className={`${pill} text-muted ring-line-strong`}>cancelled</span>
          <span className={`${pill} text-muted ring-line-strong`}><ClockIcon size={14} />expired</span>
        </div>
      </div>
      <figcaption className="mt-5 border-t border-line pt-3 text-[13px] text-muted">
        Authorized, approved and unexpired pending operations hold budget. Denied, rejected, cancelled and expired ones release it.
      </figcaption>
    </figure>
  );
}

export default function ConceptsPage() {
  return (
    <DocArticle title="Concepts" lede="Twelve terms that explain everything else in these docs." maturity="service">
      <dl className="not-prose grid gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-2">
        {TERMS.map((t) => (
          <div key={t.term} className="flex flex-col bg-abyss p-5">
            <dt className="flex items-center gap-2.5 text-[15.5px] font-medium text-mist">
              <span aria-hidden className="text-aqua">{t.icon}</span>
              {t.term}
            </dt>
            <dd className="mt-2 flex-1 text-[14px] leading-relaxed text-silver">{t.def}</dd>
            <dd className="mt-3">
              <Link href={t.see[0]} className="text-[13px] font-medium text-aqua underline-offset-4 hover:underline">{t.see[1]}</Link>
            </dd>
          </div>
        ))}
      </dl>

      <h2>An operation&apos;s life</h2>
      <p>
        Every call to <code>POST /v1/operations</code> becomes one row in the ledger. That row is the decision, the budget
        reservation and the approval record at once, so they can never disagree.
      </p>
      <StateChart />

      <h2>Units</h2>
      <table>
        <thead>
          <tr><th>Quantity</th><th>Unit</th><th>Example</th></tr>
        </thead>
        <tbody>
          <tr><td>Native value</td><td>wei, as a decimal string</td><td><code>&quot;40000000000000000&quot;</code> (0.04 ETH)</td></tr>
          <tr><td>Budgets and thresholds</td><td>USD micros, as a decimal string</td><td><code>&quot;150000000&quot;</code> ($150)</td></tr>
          <tr><td>Cooldowns and windows</td><td>whole seconds</td><td><code>60</code></td></tr>
          <tr><td>Deadlines</td><td>Unix seconds</td><td><code>1795132800</code></td></tr>
        </tbody>
      </table>
      <p>Integers only. A float in a money field is rejected, so rounding can never move a budget.</p>

      <h2>Three rules that never bend</h2>
      <ul className="not-prose my-6 space-y-3">
        {[
          [<BanIcon key="i" size={18} />, "Unknown means deny.", "A missing price, fee, policy or state is never treated as zero."],
          [<RepeatIcon key="i" size={18} />, "Same request, same answer.", "A repeated request ID returns the original decision; it is never evaluated twice."],
          [<AgentIcon key="i" size={18} />, "No model decides.", "The PALISEC Agent explains decisions. Only the deterministic engines make them."],
        ].map(([icon, t, b]) => (
          <li key={t as string} className="flex gap-3 rounded-[12px] border border-line-strong bg-deep/60 p-4">
            <span aria-hidden className="mt-0.5 text-aqua">{icon}</span>
            <span>
              <span className="block text-[15px] font-medium text-mist">{t}</span>
              <span className="mt-0.5 block text-[14px] text-silver">{b}</span>
            </span>
          </li>
        ))}
      </ul>

      <Note title="Next">
        Run the <Link href="/docs/quickstart">quickstart</Link> to see each of these in a real request.
      </Note>
    </DocArticle>
  );
}
