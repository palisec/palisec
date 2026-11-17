import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { EMPTY_STATE, EXAMPLE_ENV, EXAMPLE_POLICY, SCENARIOS, evaluate } from "@palisec/policy-schema";
import { AgentFlow } from "@/components/agent-flow";
import { BoundaryDiagram } from "@/components/boundary-diagram";
import { BrandMark, type Brand, BRAND_NAME } from "@/components/brand-icons";
import { CodeBlock } from "@/components/copy-button";
import { HeroScene } from "@/components/hero-scene";
import {
  ActivityIcon,
  AgentIcon,
  ArrowRightIcon,
  BellIcon,
  BookIcon,
  ChainIcon,
  CodeIcon,
  CpuIcon,
  FileCheckIcon,
  GaugeIcon,
  HandIcon,
  LayersIcon,
  LockIcon,
  PlugIcon,
  RepeatIcon,
  SearchIcon,
  ShieldCheckIcon,
  ShieldIcon,
  SlidersIcon,
  StopIcon,
  UserCheckIcon,
} from "@/components/icons";
import { Reveal } from "@/components/motion";
import { ReversalBand } from "@/components/reversal-band";
import { ButtonLink, Container, DecisionBadge, MaturityBadge } from "@/components/ui";
import { Workbench } from "@/components/workbench";
import { capability } from "@/lib/capabilities";

export const metadata: Metadata = {
  title: { absolute: "PALISEC · Security infrastructure for the autonomous agent economy" },
  description: "PALISEC secures autonomous on-chain execution through deterministic transaction authorization, protected signing and intelligent security operations.",
  alternates: { canonical: "/" },
};

/** Generated media is optional: used only if it has been added to /public/media. */
const media = (file: string) => (existsSync(join(process.cwd(), "public", "media", file)) ? `/media/${file}` : undefined);

/** A square tile holding one concept icon. */
const Tile = ({ children, tone = "text-aqua" }: { children: ReactNode; tone?: string }) => (
  <span aria-hidden className={`grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-raised/70 ring-1 ring-inset ring-line-strong ${tone}`}>{children}</span>
);

const WORKS_WITH: Brand[] = ["typescript", "python", "modelcontextprotocol", "langchain", "vercel", "ethereum"];

/** The three layers, top to bottom in the order a request meets them. */
const LAYERS = [
  { name: "Connect", who: "For your agents", cap: "mcp", icon: <PlugIcon size={22} />, body: "SDKs, REST, MCP and webhooks. Scoped keys an agent cannot widen.", href: "/integrations", brands: ["typescript", "python", "modelcontextprotocol"] as Brand[] },
  { name: "Agent", who: "For your operators", cap: "agent", icon: <AgentIcon size={22} />, body: "Investigates, drafts policy, prepares actions. A person confirms.", href: "/agent", brands: [] as Brand[] },
  { name: "Core", who: "The authority", cap: "engine", icon: <ShieldIcon size={22} />, body: "Two engines must agree. Budgets, replay checks and approvals.", href: "/infrastructure", brands: ["rust", "webassembly"] as Brand[] },
];

const AGENT_CAPABILITIES = [
  { icon: <SearchIcon size={20} />, title: "Investigate", body: "Repeated denials, replays and budget drain, with the records behind each one." },
  { icon: <SlidersIcon size={20} />, title: "Draft policy", body: "“$500 an hour, approval above $100” becomes a validated draft, replayed on real history." },
  { icon: <StopIcon size={20} />, title: "Prepare a stop", body: "A pause or emergency stop, with its impact. A member confirms it." },
];

const SURFACES: { name: string; cap: string; note: string; href: string; brands: Brand[]; icon?: ReactNode }[] = [
  { name: "TypeScript SDK", cap: "sdk-ts", note: "viem or ethers", href: "/docs/sdk/typescript", brands: ["typescript"] },
  { name: "Python SDK", cap: "sdk-py", note: "async, web3.py", href: "/docs/sdk/python", brands: ["python"] },
  { name: "MCP server", cap: "mcp", note: "Streamable HTTP", href: "/docs/mcp", brands: ["modelcontextprotocol"] },
  { name: "Framework tools", cap: "framework-adapters", note: "Agents SDK, AI SDK, LangGraph", href: "/integrations#frameworks", brands: ["langgraph", "vercel"] },
  { name: "REST API", cap: "api", note: "OpenAPI 3.1", href: "/docs/api", brands: ["openapiinitiative"] },
  { name: "Webhooks", cap: "webhooks", note: "HMAC-signed", href: "/docs/webhooks", brands: [], icon: <BellIcon size={26} /> },
];

const STEPS: { title: string; body: string; cap: string; tone: "allow" | "deny" | "review" | "neutral"; icon: ReactNode }[] = [
  { title: "Propose", body: "The exact transaction.", cap: "api", tone: "neutral", icon: <AgentIcon size={16} /> },
  { title: "Evaluate", body: "Policy, budget, replay, fee, price.", cap: "api", tone: "neutral", icon: <SearchIcon size={16} /> },
  { title: "Decide", body: "Two engines agree, or it denies.", cap: "engine", tone: "deny", icon: <CpuIcon size={16} /> },
  { title: "Approve", body: "Above a threshold, a person signs.", cap: "approvals", tone: "review", icon: <HandIcon size={16} /> },
  { title: "Co-sign", body: "Only that payload.", cap: "account", tone: "neutral", icon: <LockIcon size={16} /> },
  { title: "Enforce", body: "The account checks it.", cap: "account", tone: "neutral", icon: <ShieldCheckIcon size={16} /> },
  { title: "Execute", body: "Only authorized lands.", cap: "account", tone: "allow", icon: <ChainIcon size={16} /> },
  { title: "Record", body: "Append-only audit.", cap: "api", tone: "neutral", icon: <FileCheckIcon size={16} /> },
];

const INVARIANTS: [string, string, ReactNode][] = [
  ["engine", "Deterministic evaluation", <CpuIcon key="i" size={18} />],
  ["reservations", "Atomic spending limits", <GaugeIcon key="i" size={18} />],
  ["api", "Replay protection", <RepeatIcon key="i" size={18} />],
  ["approvals", "Approvals bound to the payload", <UserCheckIcon key="i" size={18} />],
  ["api", "Append-only audit", <ActivityIcon key="i" size={18} />],
  ["enclave", "Protected signing", <LockIcon key="i" size={18} />],
  ["account", "Account-level enforcement", <ShieldCheckIcon key="i" size={18} />],
];

const DEV_LINKS: [string, string, ReactNode][] = [
  ["TypeScript SDK", "/docs/sdk/typescript", <BrandMark key="b" brand="typescript" size={18} />],
  ["Python SDK", "/docs/sdk/python", <BrandMark key="b" brand="python" size={18} />],
  ["REST API", "/docs/api", <BrandMark key="b" brand="openapiinitiative" size={18} />],
  ["MCP server", "/docs/mcp", <BrandMark key="b" brand="modelcontextprotocol" size={18} />],
  ["Smart accounts", "/docs/account-abstraction", <BrandMark key="b" brand="ethereum" size={18} />],
  ["Quickstart", "/docs/quickstart", <BookIcon key="b" size={18} />],
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

const built = (cap: string) => capability(cap).maturity === "service" || capability(cap).maturity === "local";

/** Every section opens the same way: heading, then a short intro under it, on one left edge. */
function SectionHead({ id, title, lede, children }: { id: string; title: ReactNode; lede?: string; children?: ReactNode }) {
  return (
    <Reveal className="max-w-[860px]">
      <h2 id={id} className="heading text-mist">{title}</h2>
      {lede && <p className="mt-4 max-w-[58ch] text-[clamp(18px,1.35vw,21px)] leading-relaxed text-silver">{lede}</p>}
      {children}
    </Reveal>
  );
}

const SECTION = "py-20 sm:py-24";

export default function Home() {
  // A real evaluation by the reference evaluator, computed at build time.
  const swap = SCENARIOS.find((s) => s.id === "swap")!;
  const sample = evaluate(EXAMPLE_POLICY, { ...swap.intent, request_id: "ps_req_example", deadline: EXAMPLE_ENV.now + 120 }, EMPTY_STATE, EXAMPLE_ENV);

  return (
    <>
      {/* ───────── Hero: one column of text on the left, the cube behind on the right ───────── */}
      <section aria-labelledby="hero-title" className="relative -mt-[76px] overflow-hidden border-b border-line">
        <div aria-hidden className="absolute inset-0 lg:left-[45%]">
          <HeroScene videoSrc={media("hero-cube.mp4")} />
        </div>
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,rgb(1_38_36/0.92)_0%,rgb(1_38_36/0.7)_45%,rgb(1_38_36/0.05)_85%)]" />
        <Container className="relative pb-16 pt-[calc(76px+clamp(48px,9vh,104px))]">
          <div className="max-w-[860px]">
            <h1 id="hero-title" className="display text-mist">
              {["Security infrastructure", "for the autonomous", "agent economy."].map((line, i) => (
                <span key={line} className="line-mask wide" style={{ "--d": `${120 + i * 110}ms` } as CSSProperties}>
                  <span className={i === 2 ? "text-aqua" : ""}>{line}</span>
                </span>
              ))}
            </h1>
            <p className="mt-6 max-w-[42ch] text-[clamp(19px,1.45vw,22px)] leading-relaxed text-foam animate-[fade-up_.9s_var(--ease-out-quint)_.6s_both]">
              Agents decide. PALISEC authorizes every transaction they propose, before anything is signed.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3 animate-[fade-up_.9s_var(--ease-out-quint)_.75s_both]">
              <ButtonLink href="/developers">Start building</ButtonLink>
              <ButtonLink href="/infrastructure" variant="ghost" icon={<LayersIcon size={17} />}>How it works</ButtonLink>
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3 animate-[fade-up_.9s_var(--ease-out-quint)_.9s_both]">
              <span className="text-[13px] text-muted">Works with</span>
              <ul aria-label="Works with" className="flex flex-wrap items-center gap-x-5 gap-y-3 text-silver/70">
                {WORKS_WITH.map((b) => (
                  <li key={b} title={BRAND_NAME[b]} className="transition-colors hover:text-mist">
                    <BrandMark brand={b} size={20} title={BRAND_NAME[b]} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
        <Container className="relative pb-20">
          <Reveal>
            <AgentFlow />
          </Reveal>
        </Container>
      </section>

      {/* ───────── The problem ───────── */}
      <section aria-labelledby="problem-title">
        <Container className={SECTION}>
          <SectionHead
            id="problem-title"
            title={<>A valid transaction is not an <span className="text-aqua">authorized</span> one.</>}
            lede="A signature proves who sent it. It says nothing about limits, recipients or approvals. PALISEC checks those first."
          />
          <ol className="mt-12 grid grid-cols-2 overflow-hidden rounded-[14px] border border-line bg-deep/50 sm:grid-cols-4">
            {[
              ["Intent", <AgentIcon key="i" size={20} />],
              ["Proposal", <CodeIcon key="i" size={20} />],
              ["Authorization", <ShieldCheckIcon key="i" size={20} />],
              ["Execution", <ChainIcon key="i" size={20} />],
            ].map(([s, icon], i) => (
              <li key={s as string} className={`flex items-center gap-3 border-line px-5 py-5 [&:not(:first-child)]:sm:border-l ${i === 2 ? "text-aqua" : "text-mist"}`}>
                <span aria-hidden className={i === 2 ? "text-aqua" : "text-silver"}>{icon}</span>
                <span className="text-[16px] font-medium">{s}</span>
                {i < 3 && <ArrowRightIcon size={16} className="ml-auto hidden text-dim sm:block" />}
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* ───────── Layers ───────── */}
      <section aria-labelledby="layers-title" className="border-t border-line">
        <Container className={SECTION}>
          <SectionHead id="layers-title" title="One security layer. Two ways in." lede="Agents come in through Connect, operators through the Agent. Both meet the same core." />
          <ul className="mt-12 border-t border-line">
            {LAYERS.map((l, i) => (
              <Reveal as="li" key={l.name} delay={i * 80} className="border-b border-line">
                <Link href={l.href} className="group grid items-center gap-x-10 gap-y-3 py-6 transition-colors hover:bg-raised/30 md:grid-cols-[300px_minmax(0,1fr)_auto] md:px-3">
                  <div className="flex items-center gap-4">
                    <Tile tone={i === 2 ? "text-aqua" : "text-mist"}>{l.icon}</Tile>
                    <div>
                      <p className="text-[22px] font-medium tracking-[-0.01em] text-mist">PALISEC {l.name}</p>
                      <p className="mt-0.5 text-[14px] text-muted">{l.who}</p>
                    </div>
                  </div>
                  <p className="text-[17px] leading-relaxed text-silver">{l.body}</p>
                  <div className="flex items-center gap-5 md:justify-end">
                    <MaturityBadge maturity={capability(l.cap).maturity} />
                    <ArrowRightIcon size={18} className="text-dim transition-all group-hover:translate-x-1 group-hover:text-aqua" />
                  </div>
                </Link>
              </Reveal>
            ))}
          </ul>
        </Container>
      </section>

      {/* ───────── PALISEC Agent ───────── */}
      <section aria-labelledby="agent-title" className="border-y border-line bg-deep/60">
        <Container className={SECTION}>
          <SectionHead id="agent-title" title="Security intelligence, built into the execution layer." lede="Ask in plain language. Every answer links the records it used." />
          <div className="mt-12 grid items-start gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Reveal>
              <div className="overflow-hidden rounded-[16px] border border-line-strong bg-abyss">
                <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
                  <p className="flex items-center gap-2 font-utility text-[13px] font-semibold text-mist">
                    <SearchIcon size={15} className="text-aqua" /> Investigation
                  </p>
                  <p className="font-utility text-[12px] text-dim">Sample</p>
                </div>
                <div className="space-y-5 p-5 sm:p-6">
                  <p className="ml-auto w-fit max-w-[80%] rounded-[12px] rounded-br-[4px] border border-line-strong bg-raised px-4 py-2.5 text-[15px] text-mist">Why was this transaction rejected?</p>
                  <div className="flex gap-3">
                    <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-aqua/10 text-aqua ring-1 ring-aqua/30">
                      <AgentIcon size={16} />
                    </span>
                    <div className="text-[15px] leading-relaxed text-soft">
                      <p>
                        <span className="text-deny">Denied, PS_TARGET_001.</span> The target is not on the allowlist, and the default is deny. Nothing was reserved or signed.
                      </p>
                      <p className="mt-2 text-muted">Next: decide whether this contract should be allowed.</p>
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line text-[13px] sm:grid-cols-3">
                    {[
                      ["Transaction", "op·4f2a…91c0"],
                      ["Account", "0x1111…1111"],
                      ["Policy", "trading_001 v7"],
                      ["Reason", "PS_TARGET_001"],
                      ["Rule", "default = deny"],
                      ["Related", "3 denials · 24h"],
                    ].map(([k, v]) => (
                      <div key={k} className="bg-deep px-3 py-2.5">
                        <dt className="text-[12px] text-muted">{k}</dt>
                        <dd className="mt-0.5 font-mono text-[12px] text-mist">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </Reveal>
            <div>
              <ul className="space-y-6">
                {AGENT_CAPABILITIES.map((c, i) => (
                  <Reveal as="li" key={c.title} delay={i * 70} className="flex gap-4">
                    <Tile>{c.icon}</Tile>
                    <div>
                      <p className="text-[19px] font-medium text-mist">{c.title}</p>
                      <p className="mt-1 text-[16.5px] leading-relaxed text-silver">{c.body}</p>
                    </div>
                  </Reveal>
                ))}
              </ul>
              <div className="mt-8">
                <ButtonLink href="/agent" variant="ghost" icon={<AgentIcon size={17} />}>Meet the agent</ButtonLink>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* ───────── Integrations ───────── */}
      <section aria-labelledby="integrations-title">
        <Container className={SECTION}>
          <SectionHead id="integrations-title" title="Bring your own agent. Keep the boundary." lede="Whichever interface your agent uses, PALISEC authorizes it the same way." />
          <ul className="mt-12 grid gap-px overflow-hidden rounded-[16px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {SURFACES.map((s, i) => (
              <Reveal as="li" key={s.name} delay={i * 50} className="bg-abyss">
                <Link href={s.href} className="group flex h-full items-center gap-4 p-5 transition-colors hover:bg-raised/40 sm:p-6">
                  <span aria-hidden className="flex w-12 shrink-0 items-center gap-2 text-mist transition-colors group-hover:text-aqua">
                    {s.brands.slice(0, 1).map((b) => <BrandMark key={b} brand={b} size={26} />)}
                    {s.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[18px] font-medium text-mist">{s.name}</span>
                    <span className="mt-0.5 block text-[15px] text-muted">{s.note}</span>
                  </span>
                  <ArrowRightIcon size={17} className="text-dim transition-all group-hover:translate-x-1 group-hover:text-aqua" />
                </Link>
              </Reveal>
            ))}
          </ul>
        </Container>
      </section>

      {/* ───────── Execution lifecycle ───────── */}
      <section aria-labelledby="lifecycle-title" className="border-t border-line">
        <Container className={SECTION}>
          <SectionHead id="lifecycle-title" title="From intention to authorized execution." lede="One engine, three exits. Only an allowed transaction is signed.">
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <DecisionBadge decision="ALLOW" />
              <DecisionBadge decision="DENY" />
              <DecisionBadge decision="REQUIRES_HUMAN_SIGNATURE" />
            </div>
          </SectionHead>
          <Reveal delay={120} className="mt-12 max-w-[1040px]">
            <BoundaryDiagram />
          </Reveal>
          <ol className="mt-16 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => {
              const ring = s.tone === "allow" ? "text-allow ring-allow/50" : s.tone === "deny" ? "text-deny ring-deny/50" : s.tone === "review" ? "text-review ring-review/50" : built(s.cap) ? "text-aqua ring-aqua/40" : "text-dim ring-line-strong";
              return (
                <Reveal as="li" key={s.title} delay={(i % 4) * 50} className="flex gap-4">
                  <span aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-abyss ring-1 ${ring}`}>{s.icon}</span>
                  <div>
                    <h3 className="text-[17px] font-medium text-mist">
                      <span className="mr-2 font-mono text-[12px] text-dim">{String(i + 1).padStart(2, "0")}</span>
                      {s.title}
                    </h3>
                    <p className="mt-1 text-[15.5px] leading-relaxed text-silver">{s.body}</p>
                    {!built(s.cap) && <p className="mt-1.5 text-[12.5px] text-muted">Specified</p>}
                  </div>
                </Reveal>
              );
            })}
          </ol>
        </Container>
      </section>

      {/* ───────── Security band ───────── */}
      <ReversalBand>
        <Reveal className="max-w-[900px]">
          <h2 className="kinetic text-[clamp(32px,3.7vw,58px)] leading-[1.06] text-mist [text-wrap:balance]">
            Intelligence is not the authority. <span className="text-aqua">Enforcement is.</span>
          </h2>
          <p className="mt-5 max-w-[58ch] text-[clamp(18px,1.35vw,21px)] leading-relaxed text-silver">No model sits on the decision path. No agent, including ours, can override it.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/security" icon={<ShieldIcon size={17} />}>Security model</ButtonLink>
            <ButtonLink href="/architecture" variant="ghost" icon={<LayersIcon size={17} />}>Architecture</ButtonLink>
          </div>
        </Reveal>
        <Reveal delay={150}>
          <ul className="mt-14 grid gap-x-12 border-t border-line-strong sm:grid-cols-2">
            {INVARIANTS.map(([cap, text, icon]) => (
              <li key={text} className="flex items-center gap-4 border-b border-line-strong py-4 text-[17px] text-mist">
                <span aria-hidden className={built(cap) ? "text-aqua" : "text-muted"}>{icon}</span>
                <span>{text}</span>
                <span className="ml-auto">
                  <MaturityBadge maturity={capability(cap).maturity} />
                </span>
              </li>
            ))}
          </ul>
        </Reveal>
      </ReversalBand>

      {/* ───────── Developers ───────── */}
      <section aria-labelledby="developers-title">
        <Container className={SECTION}>
          <SectionHead id="developers-title" title="Integrate once. Secure every execution." lede="The real SDK and MCP configuration, tested against the live API on every change." />
          <div className="mt-12 space-y-10">
            <Reveal className="min-w-0 space-y-4 [&>div]:my-0">
              <CodeBlock code={TS} title="agent.ts" />
              <div className="grid gap-4 lg:grid-cols-2 [&>div]:my-0">
                <CodeBlock code={MCP} title="mcp.json" />
                <div className="overflow-hidden rounded-[16px] border border-line-strong bg-deep">
                  <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
                    <p className="font-mono text-[12px] text-mist">decision</p>
                    <DecisionBadge decision={sample.decision} />
                  </div>
                  <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-[1.75] text-soft">
                    {JSON.stringify({ decision: sample.decision, reason_code: sample.reason_code, policy_version: sample.policy_version, authorization_id: sample.authorization_id }, null, 2)}
                  </pre>
                </div>
              </div>
            </Reveal>
            <ul className="grid gap-x-10 border-t border-line sm:grid-cols-2 lg:grid-cols-3">
              {DEV_LINKS.map(([k, href, icon]) => (
                <li key={k} className="border-b border-line">
                  <Link href={href} className="group flex items-center gap-3 py-4 text-[17px] text-mist transition-colors hover:text-aqua">
                    <span aria-hidden className="text-silver transition-colors group-hover:text-aqua">{icon}</span>
                    {k}
                    <ArrowRightIcon size={16} className="ml-auto text-dim transition-all group-hover:translate-x-1 group-hover:text-aqua" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      {/* ───────── Workbench ───────── */}
      <section aria-labelledby="workbench-title" className="border-t border-line bg-deep/40">
        <Container className={SECTION}>
          <SectionHead id="workbench-title" title="Put a transaction against the boundary." lede="Runs the reference evaluator in your browser, on example data.">
            <div className="mt-5">
              <MaturityBadge maturity="local" />
            </div>
          </SectionHead>
          <Reveal delay={100} className="mt-10">
            <Workbench />
          </Reveal>
        </Container>
      </section>

      {/* ───────── Close ───────── */}
      <section aria-labelledby="close-title" className="relative overflow-hidden border-t border-line">
        <div aria-hidden className="aurora right-[-10%] top-[-20%] h-[520px] w-[820px] bg-aqua/[0.08]" />
        <Container className="relative py-24 sm:py-32">
          <Reveal className="max-w-[900px]">
            <h2 id="close-title" className="display text-[clamp(34px,4.2vw,64px)] text-mist">
              Build autonomous agents. <span className="text-aqua">Give their execution a boundary.</span>
            </h2>
            <p className="mt-5 flex items-center gap-3 text-[18px] text-silver">
              <BrandMark brand="ethereum" size={18} className="text-silver/70" />
              Live on Robinhood Chain. Free during pre-release.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/developers">Start building</ButtonLink>
              <ButtonLink href="/docs" variant="ghost" icon={<BookIcon size={17} />}>Docs</ButtonLink>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
