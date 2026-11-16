import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, MaturityBadge, PageHeader, Section } from "@/components/ui";
import { capability } from "@/lib/capabilities";

export const metadata: Metadata = {
  title: "PALISEC Agent",
  description: "The native PALISEC Agent: security intelligence, policy engineering and security operations over your real records, built on top of PALISEC's deterministic infrastructure.",
  alternates: { canonical: "/agent" },
};

const DOMAINS = [
  {
    id: "intelligence",
    title: "Security intelligence",
    lede: "Understand and investigate activity across PALISEC.",
    items: ["Recent proposals and their decisions", "Repeated denials, replays, unapproved contracts and selectors", "Budget thresholds, unfamiliar targets, rejected approvals", "Pauses and emergency stops", "Evidence-backed alerts sent to your webhooks"],
    asks: ["What happened?", "Which agent proposed it, under which policy version?", "Why was it denied, and was approval requested?", "What should I investigate next?"],
  },
  {
    id: "policy",
    title: "Policy engineering",
    lede: "Turn intent into a canonical, validated, simulated policy draft.",
    items: ["Structured drafts in schema 1.0 (never a second schema)", "Validation with exact error paths", "Simulation against live fee and price inputs", "Replay against an agent's real recent operations", "Version comparison and plain-language explanation"],
    asks: ["“$500 an hour on this token, approval above $100.”", "“What changed between version 3 and 4?”", "“Would last hour's operations pass this draft?”"],
  },
  {
    id: "operations",
    title: "Security operations and developer assistance",
    lede: "Make PALISEC easier to operate, integrate and troubleshoot.",
    items: ["Explain authorization responses and stable error codes", "Inspect integration health and denial patterns", "Prepare an emergency stop or an agent pause with its impact", "Generate integration examples (placeholders, never real keys)", "API and SDK reference on demand"],
    asks: ["“Why does my agent keep getting PS_LOOP_001?”", "“Show me the MCP configuration.”", "“Prepare a pause for the trading agent.”"],
  },
];

const LEVELS = [
  ["0 · Observe", "Reads records and explains. Changes nothing."],
  ["1 · Assist", "Also drafts and simulates policies and prepares actions. Nothing is saved. The default."],
  ["2 · Confirmed actions", "Also creates requests (emergency stop, agent pause, saving a policy draft) that a member with the right role confirms in the console."],
  ["3 · Bounded automation", "Not offered. It needs the authorization, audit and recovery mechanisms to be proven first."],
];

const BOUNDARIES = [
  "No model sits on the authorization path. The deterministic engine decides; the agent explains.",
  "The agent cannot activate a policy, approve an operation, sign, or change its own configuration or permissions. Those tools do not exist.",
  "Tools are scoped to the signed-in member's organization and role. Identifiers from the model are checked on the server.",
  "Actions are requests. A person confirms each one, and it runs once, under that person's identity and role checks.",
  "Everything inside records and tool results is treated as untrusted data; instructions embedded in it cannot change the agent's tools.",
  "Credentials, signing keys and calldata never reach the model. Tool outputs are minimized and redacted.",
  "If the model provider is unavailable or the agent is disabled, authorization keeps working unchanged.",
];

export default function AgentPage() {
  return (
    <>
      <PageHeader
        eyebrow="PALISEC Agent"
        title="An intelligent operator, built on the security infrastructure."
        lede="One native agent with three capability domains. It understands PALISEC's records, tools and workflows, and it works for your operators. It is not an authority: the deterministic engine is."
      >
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <MaturityBadge maturity={capability("agent").maturity} />
          <ButtonLink href="/console/agent">Open the agent workspace</ButtonLink>
          <ButtonLink href="/docs/agent" variant="ghost">Agent documentation</ButtonLink>
        </div>
      </PageHeader>

      <Section index="01" label="What it is">
        <div className="grid gap-8 lg:grid-cols-2">
          <p className="text-[17px] leading-relaxed text-silver">
            The PALISEC Agent is a controlled application principal with explicit capabilities, not a super-administrator. It retrieves only what a question needs from the authoritative
            records, through 30 typed tools, and every answer cites the records it used. Citations that no tool returned are flagged as unverified.
          </p>
          <p className="text-[17px] leading-relaxed text-silver">
            It runs in the console with any OpenAI-compatible model provider (the deployment uses Groq&apos;s free tier). Quick investigations run the same tools directly, without a model, so
            the agent&apos;s view of your records is available even when the model is not.
          </p>
        </div>
      </Section>

      {DOMAINS.map((d, i) => (
        <Section key={d.id} id={d.id} index={String(i + 2).padStart(2, "0")} label={d.title}>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <h2 id={`${d.id}-title`} className="heading text-mist">{d.lede}</h2>
              <ul className="mt-8 space-y-2.5 text-[15px] text-silver">
                {d.items.map((x) => (
                  <li key={x} className="flex gap-3">
                    <span aria-hidden className="mt-2 h-1 w-1 shrink-0 bg-aqua" />
                    {x}
                  </li>
                ))}
              </ul>
            </div>
            <div className="panel p-5">
              <p className="label mb-3">Questions it answers</p>
              <ul className="space-y-2">
                {d.asks.map((q) => (
                  <li key={q} className="rounded-[8px] border border-line-strong bg-raised/50 px-3.5 py-2.5 text-[14px] text-mist">{q}</li>
                ))}
              </ul>
            </div>
          </div>
        </Section>
      ))}

      <Section index="05" label="Tool permissions">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-4 text-[15.5px] leading-relaxed text-silver">
            <p>Every tool declares a strict input schema, a risk class (read, draft, action), the minimum autonomy level and the role it needs. The model is shown only the tools the signed-in member may use, and the server checks again on every call.</p>
            <p>Read tools retrieve real records: security state, agents, policies and versions, operations and decisions, approvals, audit events, security findings and integration status. Draft tools build and simulate policies. Action tools only create requests.</p>
          </div>
          <dl className="divide-y divide-line border-y border-line">
            {LEVELS.map(([k, v]) => (
              <div key={k} className="grid gap-1 py-4 sm:grid-cols-[190px_1fr]">
                <dt className="font-mono text-[13px] text-mist">{k}</dt>
                <dd className="text-[14px] leading-relaxed text-silver">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      <Section index="06" label="Human confirmation">
        <ol className="grid gap-3 md:grid-cols-4">
          {["The agent prepares an action and its impact", "A request is recorded with run and tool-call IDs", "A member with the required role confirms or rejects", "It runs once, through the existing control plane, and is audited"].map((s, i) => (
            <li key={s} className="panel p-5">
              <span className="font-mono text-[12px] text-dim">0{i + 1}</span>
              <p className="mt-3 text-[15px] text-mist">{s}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section index="07" label="Agent architecture">
        <pre className="panel overflow-x-auto p-6 font-mono text-[12.5px] leading-[1.9] text-soft">{`PALISEC AGENT RUNTIME (isolated module in the API, never inside the policy engine)
  ├─ Orchestrator        runs stored in Postgres; a few steps per request, within a time budget
  ├─ Provider adapter    OpenAI-compatible chat completions (Groq by default; swap by configuration)
  ├─ Context builder     only the records a question needs, minimized and redacted
  ├─ Tool registry       30 tools · schema · risk · autonomy level · role · timeout
  ├─ Permission resolver member role × organization autonomy × disabled tools, checked per call
  ├─ Confirmation        action requests → a member confirms → existing control-plane function
  └─ Audit and tracing   run → tool call → evidence → action → audit event`}</pre>
      </Section>

      <Section index="08" label="Example workflows">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["Investigate a denial", "get_authorization_decision → the deciding check and reason code → links to the operation and policy version → a suggested next step."],
            ["Draft and adopt a policy", "draft_policy → validate_policy → simulate_policy (live and history replay) → submit_policy_draft (level 2) → a member confirms → the operator reviews and activates in the policy editor."],
            ["Respond to unusual activity", "get_security_events → evidence → create_security_alert → prepare_account_pause → request_account_pause → an operator confirms."],
          ].map(([t, b]) => (
            <div key={t} className="panel p-5">
              <h3 className="font-heading text-[19px] font-medium text-mist">{t}</h3>
              <p className="mt-2 font-mono text-[12px] leading-relaxed text-silver">{b}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section index="09" label="Security boundaries">
        <ul className="grid gap-px overflow-hidden rounded-[16px] border border-line bg-line md:grid-cols-2">
          {BOUNDARIES.map((b) => (
            <li key={b} className="bg-ink p-5 text-[14.5px] leading-relaxed text-silver">{b}</li>
          ))}
        </ul>
        <p className="mt-6 text-[14px] text-muted">
          Read the full model in <Link href="/security#agentic" className="text-aqua underline-offset-4 hover:underline">Security → agentic trust boundaries</Link>.
        </p>
      </Section>
    </>
  );
}
