import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { EMPTY_STATE, EXAMPLE_ENV, EXAMPLE_POLICY, SCENARIOS, evaluate } from "@palisec/policy-schema";
import { AgentFlow } from "@/components/agent-flow";
import { BoundaryDiagram } from "@/components/boundary-diagram";
import { CodeBlock } from "@/components/copy-button";
import { HeroScene } from "@/components/hero-scene";
import { Reveal } from "@/components/motion";
import { ReversalBand } from "@/components/reversal-band";
import { ButtonLink, Container, DecisionBadge, MaturityBadge, Section } from "@/components/ui";
import { Workbench } from "@/components/workbench";
import { capability } from "@/lib/capabilities";

export const metadata: Metadata = {
  title: { absolute: "PALISEC · Security infrastructure for the autonomous agent economy" },
  description: "PALISEC secures autonomous on-chain execution through deterministic transaction authorization, protected signing and intelligent security operations.",
  alternates: { canonical: "/" },
};

/** Generated media is optional: used only if it has been added to /public/media. */
const media = (file: string) => (existsSync(join(process.cwd(), "public", "media", file)) ? `/media/${file}` : undefined);

const HEADLINE = ["Security infrastructure", "for the autonomous", "agent economy."];

const LAYERS = [
  {
    name: "PALISEC Core",
    cap: "engine",
    body: "Deterministic authorization, atomic budget reservations, replay protection and human approvals. Protected signing and smart-account enforcement complete it.",
    href: "/infrastructure",
  },
  {
    name: "PALISEC Agent",
    cap: "agent",
    body: "Native intelligence for monitoring, investigation, policy engineering and security operations, grounded in your records.",
    href: "/agent",
  },
  {
    name: "PALISEC Connect",
    cap: "mcp",
    body: "SDKs, the REST API, an MCP server and signed webhooks for independently built autonomous agents.",
    href: "/integrations",
  },
] as const;

const AGENT_PANELS = [
  { title: "Security intelligence", body: "Repeated denials, replayed requests, unapproved contracts and budget thresholds, detected deterministically and explained with the records behind them.", cap: "security-events" },
  { title: "Policy engineering", body: "From “$500 an hour on this token, approval above $100” to a canonical schema-1.0 draft, validated and simulated against live inputs and your real history.", cap: "agent" },
  { title: "Security operations", body: "Prepares an emergency stop or an agent pause with its impact. A member with the right role confirms it; the agent never acts alone.", cap: "agent" },
] as const;

const SURFACES = [
  { name: "TypeScript SDK", cap: "sdk-ts", note: "viem or ethers · sends only on ALLOW", href: "/docs/sdk/typescript" },
  { name: "Python SDK", cap: "sdk-py", note: "async · web3.py adapter", href: "/docs/sdk/python" },
  { name: "REST API", cap: "api", note: "OpenAPI 3.1 · idempotent", href: "/docs/api" },
  { name: "MCP server", cap: "mcp", note: "Streamable HTTP · scoped keys", href: "/docs/mcp" },
  { name: "Webhooks", cap: "webhooks", note: "HMAC-signed events", href: "/docs/webhooks" },
  { name: "Framework tools", cap: "framework-adapters", note: "OpenAI Agents · Vercel AI · LangGraph", href: "/integrations#frameworks" },
] as const;

const STEPS: { n: string; title: string; body: string; cap?: string; tone: "allow" | "deny" | "review" | "neutral" }[] = [
  { n: "1", title: "Agent proposes", body: "The agent describes the exact transaction it wants to send.", tone: "neutral", cap: "api" },
  { n: "2", title: "PALISEC evaluates", body: "Authoritative state: active policy version, reservations, replay and loop history, live fee and price.", tone: "neutral", cap: "api" },
  { n: "3", title: "Policy engine decides", body: "Rust and the reference evaluator must agree. Deny wins; any missing input denies.", tone: "deny", cap: "engine" },
  { n: "4", title: "Human approval", body: "Above a threshold or for unknown methods, an approver signs the exact operation.", tone: "review", cap: "approvals" },
  { n: "5", title: "Protected signing", body: "A policy-bound signer authorizes only that payload.", tone: "neutral", cap: "enclave" },
  { n: "6", title: "Smart account enforces", body: "Validation rejects operations without a valid PALISEC authorization.", tone: "neutral", cap: "account" },
  { n: "7", title: "Blockchain executes", body: "Only an authorized operation can reach the chain.", tone: "allow", cap: "account" },
  { n: "8", title: "Audit records", body: "Every decision, approval and action, append-only.", tone: "neutral", cap: "api" },
];

const INVARIANTS: [string, string][] = [
  ["engine", "Deterministic policy evaluation"],
  ["reservations", "Atomic spending controls"],
  ["enclave", "Protected signing"],
  ["account", "Account-level enforcement"],
  ["api", "Replay protection and idempotency"],
  ["approvals", "Human approvals bound to the exact payload"],
  ["api", "Auditable execution"],
];

const TS = `import { createPalisec, PalisecDeniedError } from "@palisec/sdk";

const palisec = createPalisec({ apiKey: process.env.PALISEC_API_KEY! });

try {
  const { operation, hash } = await palisec.sendTransaction(wallet, {
    to: TOKEN, data: transferCalldata, gasLimit: 90_000,
  });
  if (!hash) console.log("held for a human approver", operation.operationId);
} catch (e) {
  if (e instanceof PalisecDeniedError) console.warn(e.code); // nothing was sent
  else throw e;
}`;

const MCP = `{
  "mcpServers": {
    "palisec": {
      "type": "http",
      "url": "https://palisec.tech/api/mcp",
      "headers": { "Authorization": "Bearer \${PALISEC_API_KEY}" }
    }
  }
}`;

export default function Home() {
  // A real evaluation by the reference evaluator, computed at build time.
  const swap = SCENARIOS.find((s) => s.id === "swap")!;
  const sample = evaluate(EXAMPLE_POLICY, { ...swap.intent, request_id: "ps_req_example", deadline: EXAMPLE_ENV.now + 120 }, EMPTY_STATE, EXAMPLE_ENV);
  const clusters = media("cubes-left.png") && media("cubes-right.png") ? { left: "/media/cubes-left.png", right: "/media/cubes-right.png" } : undefined;

  return (
    <>
      {/* ───────── Hero ───────── */}
      <section aria-labelledby="hero-title" className="relative -mt-[76px] flex min-h-[100svh] flex-col overflow-hidden">
        <HeroScene videoSrc={media("hero-cube.mp4")} />
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_62%_46%_at_50%_40%,rgb(1_38_36/0.66),transparent_76%)]" />
        <Container className="relative flex flex-1 flex-col items-center justify-center pb-24 pt-28 text-center">
          <p className="label mb-7 flex items-center gap-3 !text-mist animate-[fade-up_.8s_var(--ease-out-quint)_both]">
            <span aria-hidden className="tick-dot" />
            Intelligent security infrastructure
          </p>
          <h1 id="hero-title" className="display text-[clamp(44px,8.2vw,88px)] text-mist">
            {HEADLINE.map((line, i) => (
              <span key={line} className="line-mask wide" style={{ "--d": `${120 + i * 120}ms` } as CSSProperties}>
                <span className={i === HEADLINE.length - 1 ? "text-signal" : "text-lit"}>{line}</span>
              </span>
            ))}
          </h1>
          <p className="mt-6 font-utility text-[13px] uppercase tracking-[0.12em] text-aqua animate-[fade-up_.9s_var(--ease-out-quint)_.7s_both]">
            Intelligent security infrastructure for autonomous on-chain agents
          </p>
          <p className="mt-6 max-w-[640px] text-base leading-relaxed text-foam animate-[fade-up_.9s_var(--ease-out-quint)_.8s_both] [text-wrap:pretty] sm:text-lg">
            PALISEC secures autonomous on-chain execution through deterministic transaction authorization, protected signing and intelligent security operations. Build agents that can act
            independently without giving up control of what they execute.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3 animate-[fade-up_.9s_var(--ease-out-quint)_1s_both]">
            <ButtonLink href="/infrastructure">Explore the infrastructure</ButtonLink>
            <ButtonLink href="/docs" variant="ghost">Read the documentation</ButtonLink>
          </div>
          <Link href="/agent" className="mt-5 font-utility text-[12px] uppercase tracking-[0.12em] text-silver underline-offset-4 transition-colors hover:text-aqua hover:underline animate-[fade-up_.9s_var(--ease-out-quint)_1.1s_both]">
            Meet the PALISEC Agent →
          </Link>
        </Container>
      </section>

      {/* ───────── Hero visual: the boundary, and the agent observing it ───────── */}
      <Section className="!pt-0" id="boundary">
        <Reveal>
          <div className="mx-auto max-w-[980px]">
            <p className="mb-5 text-center font-heading text-[clamp(20px,2.6vw,28px)] font-medium leading-snug tracking-[-0.02em] text-mist [text-wrap:balance]">
              AI agents can propose operations. <span className="text-aqua">PALISEC independently determines whether those operations can execute.</span>
            </p>
            <AgentFlow />
          </div>
        </Reveal>
      </Section>

      {/* ───────── 3 · The problem ───────── */}
      <Section index="01" label="The problem" id="problem">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <Reveal>
            <h2 id="problem-title" className="heading text-mist">Autonomous execution creates a new security boundary.</h2>
          </Reveal>
          <Reveal delay={120} className="space-y-5 text-[17px] leading-relaxed text-silver">
            <p>AI agents can independently plan and initiate transactions. But a valid transaction is not necessarily an authorized transaction.</p>
            <p>A wallet signature alone does not establish whether the action complies with spending limits, recipient restrictions, contract rules or approval requirements.</p>
            <p className="text-mist">PALISEC introduces an independent authorization and enforcement layer between agent intention and on-chain execution.</p>
          </Reveal>
        </div>
        <Reveal delay={200}>
          <ol className="mt-14 grid gap-px overflow-hidden rounded-[16px] border border-line bg-line sm:grid-cols-4">
            {["Agent intention", "Transaction proposal", "Independent authorization", "Protected execution"].map((s, i) => (
              <li key={s} className="flex items-center gap-3 bg-ink px-5 py-5">
                <span className="font-mono text-[11px] text-dim">0{i + 1}</span>
                <span className={`text-[15px] ${i === 2 ? "text-aqua" : "text-mist"}`}>{s}</span>
              </li>
            ))}
          </ol>
        </Reveal>
      </Section>

      {/* ───────── 4 · Architecture ───────── */}
      <Section index="02" label="Architecture" id="layers">
        <Reveal>
          <h2 id="layers-title" className="heading max-w-[20ch] text-mist">One security layer. Two ways to work with it.</h2>
          <p className="mt-5 max-w-[640px] text-silver">Your own agents integrate through PALISEC Connect; your operators work with the PALISEC Agent. Both converge on the same deterministic core. Neither gets a route around it.</p>
        </Reveal>
        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {LAYERS.map((l, i) => (
            <Reveal key={l.name} delay={i * 90}>
              <Link href={l.href} className="panel group flex h-full flex-col p-6 transition-colors hover:border-aqua/50">
                <div className="mb-8 flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-dim">0{i + 1}</span>
                  <MaturityBadge maturity={capability(l.cap).maturity} />
                </div>
                <h3 className="font-heading text-[26px] font-medium tracking-[-0.02em] text-mist">{l.name}</h3>
                <p className="mt-3 flex-1 text-[14.5px] leading-relaxed text-silver">{l.body}</p>
                <span className="mt-6 font-utility text-[11px] uppercase tracking-[0.1em] text-aqua">Explore →</span>
              </Link>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ───────── 5 · Native agent ───────── */}
      <Section index="03" label="PALISEC Agent" id="agent">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
          <div>
            <Reveal>
              <h2 id="agent-title" className="heading text-mist">Security intelligence built into the execution layer.</h2>
              <p className="mt-6 max-w-[560px] text-[17px] leading-relaxed text-silver">
                PALISEC Agent gives operators an intelligent way to understand, investigate and manage autonomous on-chain activity. It turns security events, policy decisions and transaction
                records into actionable operational context.
              </p>
            </Reveal>
            <div className="mt-10 space-y-3">
              {AGENT_PANELS.map((p, i) => (
                <Reveal key={p.title} delay={i * 80}>
                  <div className="panel p-5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-heading text-[19px] font-medium text-mist">{p.title}</h3>
                      <MaturityBadge maturity={capability(p.cap).maturity} />
                    </div>
                    <p className="mt-2 text-[14px] leading-relaxed text-silver">{p.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
          <Reveal delay={150}>
            <div className="panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <p className="label !text-[10px]">Investigation</p>
                <p className="font-utility text-[9.5px] uppercase tracking-[0.1em] text-lilac">◆ Illustrative demo · sample data</p>
              </div>
              <div className="space-y-4 p-5">
                <p className="ml-auto max-w-[80%] rounded-[10px] rounded-br-[4px] border border-line-strong bg-raised px-3.5 py-2.5 text-[14px] text-mist">Why was this transaction rejected?</p>
                <div className="border-l-2 border-aqua/50 pl-4 text-[14px] leading-relaxed text-soft">
                  <p className="label mb-1.5 !text-[9.5px]">PALISEC Agent</p>
                  <p>
                    It was <span className="text-deny">denied with PS_TARGET_001</span>: the target is not on the policy&apos;s allowlist, and the default is deny. Nothing was reserved or signed.
                  </p>
                  <p className="mt-2 text-muted">Next: confirm whether this contract should be allowed, and review the agent&apos;s other attempts in the last hour.</p>
                </div>
                <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line text-[12px]">
                  {[
                    ["Transaction", "op·4f2a…91c0"],
                    ["Account", "0x1111…1111"],
                    ["Policy version", "policy_trading_001 v7"],
                    ["Denial reason", "PS_TARGET_001"],
                    ["Relevant rule", "contracts.default = deny"],
                    ["Next investigation", "repeated denials · 24h"],
                  ].map(([k, v]) => (
                    <div key={k} className="bg-ink px-3 py-2">
                      <dt className="label !text-[9.5px]">{k}</dt>
                      <dd className="mt-0.5 font-mono text-[11.5px] text-mist">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-[12px] text-muted">In the console, every reference links to the actual record, and answers that cite records no tool returned are flagged.</p>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ───────── 6 · Integrations ───────── */}
      <Section index="04" label="Integrations" id="integrations">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-16">
          <Reveal>
            <h2 id="integrations-title" className="heading text-mist">Bring your own agent. Keep the security boundary.</h2>
            <p className="mt-6 text-[17px] leading-relaxed text-silver">
              PALISEC works with independently developed autonomous agents. Integrate through developer SDKs, direct APIs and MCP-compatible tools. Your agent retains its reasoning and workflow.
              PALISEC provides the transaction authorization and protected execution layer.
            </p>
            <div className="mt-8">
              <ButtonLink href="/integrations" variant="ghost">Integration guide</ButtonLink>
            </div>
          </Reveal>
          <ul className="grid gap-px overflow-hidden rounded-[16px] border border-line bg-line sm:grid-cols-2">
            {SURFACES.map((s, i) => (
              <Reveal as="li" key={s.name} delay={i * 50} className="bg-ink">
                <Link href={s.href} className="flex h-full flex-col gap-2 p-5 transition-colors hover:bg-raised/60">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[15.5px] text-mist">{s.name}</span>
                    <MaturityBadge maturity={capability(s.cap).maturity} />
                  </span>
                  <span className="font-mono text-[11.5px] text-dim">{s.note}</span>
                </Link>
              </Reveal>
            ))}
          </ul>
        </div>
      </Section>

      {/* ───────── 7 · How execution works ───────── */}
      <Section index="05" label="How execution works" id="lifecycle">
        <Reveal>
          <h2 id="lifecycle-title" className="heading max-w-[20ch] text-mist">From agent intention to authorized execution.</h2>
        </Reveal>
        <Reveal delay={100}>
          <div className="mt-10">
            <BoundaryDiagram />
          </div>
        </Reveal>
        <ol className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => {
            const m = s.cap ? capability(s.cap).maturity : "service";
            const ring = s.tone === "allow" ? "border-allow/45" : s.tone === "deny" ? "border-deny/45" : s.tone === "review" ? "border-review/45 border-dashed" : "border-line";
            return (
              <Reveal as="li" key={s.n} delay={i * 50} className={`panel border ${ring} p-5`}>
                <div className="mb-4 flex items-center justify-between">
                  <span className="font-mono text-[12px] text-dim">{s.n.padStart(2, "0")}</span>
                  {m !== "service" && <MaturityBadge maturity={m} />}
                </div>
                <h3 className="text-[16px] font-medium text-mist">{s.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-silver">{s.body}</p>
              </Reveal>
            );
          })}
        </ol>
        <div className="mt-8 flex flex-wrap items-center gap-3 text-[13px] text-muted">
          <DecisionBadge decision="ALLOW" /> <DecisionBadge decision="DENY" /> <DecisionBadge decision="REQUIRES_HUMAN_SIGNATURE" />
          <span>Steps 5 to 7 are specified, not deployed: today the agent sends its own transaction after an ALLOW.</span>
        </div>
      </Section>

      {/* ───────── 8 · Security architecture ───────── */}
      <ReversalBand clusterImages={clusters}>
        <Reveal>
          <p className="mb-8 font-utility text-[11px] font-medium uppercase tracking-[0.12em] text-aqua-lo">Security architecture</p>
        </Reveal>
        <h2 className="mx-auto max-w-[16ch] kinetic text-[clamp(28px,4.6vw,56px)] leading-[1.04] text-abyss [text-wrap:balance]">
          {["Intelligence is", "not the authority.", "Enforcement is."].map((l, i) => (
            <Reveal key={l} as="span" delay={i * 90} className="block">{l}</Reveal>
          ))}
        </h2>
        <Reveal delay={400}>
          <p className="mx-auto mt-8 max-w-[600px] leading-relaxed text-abyss/75">
            PALISEC&apos;s authorization is deterministic and independently enforced. The PALISEC Agent can investigate and assist, but no model sits on the decision path, and no agent,
            including PALISEC&apos;s own, can override the policy engine.
          </p>
        </Reveal>
        <Reveal delay={480}>
          <ul className="mx-auto mt-10 grid max-w-[760px] gap-2 text-left sm:grid-cols-2">
            {INVARIANTS.map(([cap, text]) => (
              <li key={text} className="flex items-center justify-between gap-3 rounded-[8px] border border-abyss/15 bg-abyss/[0.04] px-4 py-2.5 text-[14px] text-abyss">
                <span>{text}</span>
                <span className="font-utility text-[10px] uppercase tracking-[0.08em] text-abyss/60">{capability(cap).maturity === "service" ? "● built" : "◐ specified"}</span>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={560}>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/security" variant="dark">Security model</ButtonLink>
            <ButtonLink href="/architecture" variant="ghost-dark">Architecture</ButtonLink>
          </div>
        </Reveal>
      </ReversalBand>

      {/* ───────── 9 · Developer experience ───────── */}
      <Section index="06" label="Developers" id="developers">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-16">
          <Reveal>
            <h2 id="developers-title" className="heading text-mist">Integrate once. Secure autonomous execution.</h2>
            <p className="mt-6 text-silver">These snippets are the real SDK and MCP configuration, exercised against the live API in CI on every change.</p>
            <ul className="mt-8 divide-y divide-line border-y border-line">
              {[
                ["TypeScript", "/docs/sdk/typescript"],
                ["Python", "/docs/sdk/python"],
                ["REST API", "/docs/api"],
                ["MCP", "/docs/mcp"],
                ["Smart-account architecture", "/docs/account-abstraction"],
                ["Testnet setup", "/docs/quickstart"],
              ].map(([k, href]) => (
                <li key={k}>
                  <Link href={href} className="flex items-center justify-between py-3 text-[15px] text-mist transition-colors hover:text-aqua">
                    {k} <span aria-hidden className="text-dim">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={120} className="min-w-0">
            <CodeBlock code={TS} title="agent.ts" />
            <CodeBlock code={MCP} title="mcp.json" />
            <div className="panel mt-6 overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <p className="label !text-[10px]">Decision record · real reference-evaluator output</p>
                <DecisionBadge decision={sample.decision} />
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-[1.75] text-soft">
                {JSON.stringify({ request_id: sample.request_id, decision: sample.decision, reason_code: sample.reason_code, policy_id: sample.policy_id, policy_version: sample.policy_version, authorization_id: sample.authorization_id }, null, 2)}
              </pre>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ───────── Workbench ───────── */}
      <Section index="07" label="Policy workbench" id="workbench">
        <Reveal>
          <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
            <h2 id="workbench-title" className="heading max-w-[18ch] text-mist">Put a transaction against the boundary.</h2>
            <MaturityBadge maturity="local" />
          </div>
        </Reveal>
        <Reveal delay={100}>
          <Workbench />
        </Reveal>
      </Section>

      {/* ───────── 10 · Final CTA ───────── */}
      <Section className="overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="aurora left-1/2 top-[18%] h-[420px] w-[760px] -translate-x-1/2 bg-aqua/[0.09] animate-[drift-c_24s_ease-in-out_infinite]" />
          <div className="horizon bottom-[14%] opacity-70" />
        </div>
        <div className="relative flex flex-col items-center text-center">
          <Reveal>
            <h2 className="display max-w-[18ch] text-mist">
              <span className="text-lit">Build autonomous agents. </span>
              <span className="text-signal">Give their execution a security boundary.</span>
            </h2>
          </Reveal>
          <Reveal delay={200}>
            <div className="mt-12 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/infrastructure">Explore PALISEC</ButtonLink>
              <ButtonLink href="/developers" variant="ghost">Start building</ButtonLink>
            </div>
          </Reveal>
        </div>
      </Section>
    </>
  );
}
