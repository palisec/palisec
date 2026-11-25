import type { Metadata } from "next";
import { LinePageHeader, LineSection } from "@/components/line/compat";
import { pageOpenGraph } from "@/lib/seo";
import type { ReactNode } from "react";
import Link from "next/link";
import { BrandMark, type Brand } from "@/components/brand-icons";
import { SCHEMA_LABEL } from "@/lib/versions";
import {
  ActivityIcon,
  AgentIcon,
  BanIcon,
  BellIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  CpuIcon,
  DatabaseIcon,
  FileCheckIcon,
  GaugeIcon,
  GlobeIcon,
  HandIcon,
  KeyIcon,
  LayersIcon,
  LockIcon,
  PlugIcon,
  RepeatIcon,
  SearchIcon,
  ServerIcon,
  ShieldCheckIcon,
  ShieldIcon,
  StopIcon,
  UserCheckIcon,
  WalletIcon,
  ZapIcon,
} from "@/components/icons";
import { MaturityBadge } from "@/components/ui";
import { EMPTY_STATE, evaluate, type Environment, type Intent } from "@palisec/policy-schema";

export const metadata: Metadata = {
  title: "Architecture",
  description: "How Palisec is built: the system map, a request's path in order, the data model, trust boundaries, failure handling and the stack.",
  alternates: { canonical: "/architecture" }, openGraph: pageOpenGraph("/architecture"),
};

/* ───────── System map ───────── */

function Node({ icon, brand, title, sub, planned = false, accent = false }: { icon?: ReactNode; brand?: Brand; title: string; sub: string; planned?: boolean; accent?: boolean }) {
  return (
    <div
      className={`flex items-start gap-3 rounded-[10px] px-3 py-2.5 ${accent ? "bg-aqua/[0.07]" : ""}`}
    >
      <span aria-hidden className={`mt-0.5 shrink-0 ${planned ? "text-dim" : accent ? "text-aqua" : "text-silver"}`}>
        {brand ? <BrandMark brand={brand} size={18} /> : icon}
      </span>
      <span className="min-w-0">
        <span className={`block text-[14.5px] font-medium ${planned ? "text-muted" : "text-mist"}`}>{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{sub}</span>
      </span>
      {planned && <span className="ml-auto shrink-0 rounded-full px-2 py-0.5 font-utility text-[11px] font-semibold text-muted ring-1 ring-inset ring-line-strong">Planned</span>}
    </div>
  );
}

function Column({ title, children, className = "" }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="label mb-2.5 flex items-center gap-2">{title}</p>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-1">{children}</div>
    </div>
  );
}

function SystemMap() {
  return (
    <figure className="overflow-hidden rounded-[16px] border border-line-strong bg-deep/50" aria-labelledby="map-cap">
      <div className="grid gap-8 p-5 sm:p-7 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)_minmax(0,1fr)] 2xl:gap-6">
        <Column title="Callers">
          <Node icon={<AgentIcon size={18} />} title="Your agents" sub="SDK, REST or MCP with a scoped key" />
          <div className="flex items-center gap-3 px-1 py-2 text-silver/70">
            <BrandMark brand="typescript" size={18} title="TypeScript" />
            <BrandMark brand="python" size={18} title="Python" />
            <BrandMark brand="modelcontextprotocol" size={18} title="MCP" />
            <BrandMark brand="langgraph" size={18} title="LangGraph" />
          </div>
          <Node icon={<UserCheckIcon size={18} />} title="Operators" sub="Console, wallet sign-in, roles" />
          <Node icon={<HandIcon size={18} />} title="Approvers" sub="EIP-712 signature in their own wallet" />
        </Column>

        <div className="relative rounded-[14px] border border-aqua/30 bg-abyss/60 p-4 sm:p-5">
          <p className="label mb-3 flex items-center gap-2">
            <BrandMark brand="vercel" size={14} /> Palisec on Vercel
          </p>
          <div className="grid gap-2.5">
            <Node icon={<GlobeIcon size={18} />} title="Proxy" sub="Host allowlist, security headers, sessions" />
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-2">
              <Node icon={<ShieldIcon size={18} />} title="Authorization API" sub="/v1/operations: evaluate, reserve, record" accent />
              <Node icon={<LayersIcon size={18} />} title="Control plane" sub="Policies, agents, keys, approvals, stops" />
              <Node icon={<AgentIcon size={18} />} title="Agent runtime" sub="Runs, 30 typed tools, action requests" />
              <Node icon={<PlugIcon size={18} />} title="MCP server" sub="/api/mcp, stateless Streamable HTTP" />
            </div>
            <div className="rounded-[10px] bg-aqua/[0.07] p-3">
              <p className="flex items-center gap-2 text-[14.5px] font-medium text-mist">
                <CpuIcon size={18} className="text-aqua" /> Policy engine, twice
              </p>
              <div className="mt-2.5 grid grid-cols-2 gap-2 text-[12.5px]">
                <span className="flex items-center gap-2 rounded-[8px] bg-deep px-2.5 py-2 text-soft">
                  <BrandMark brand="rust" size={15} /> Rust → <BrandMark brand="webassembly" size={15} />
                </span>
                <span className="flex items-center gap-2 rounded-[8px] bg-deep px-2.5 py-2 text-soft">
                  <BrandMark brand="typescript" size={15} /> Reference
                </span>
              </div>
              <p className="mt-2 text-[12.5px] text-muted">Every field must match, or the request is denied.</p>
            </div>
            <Node icon={<BellIcon size={18} />} title="Webhook dispatcher" sub="After the response; HMAC-signed, 3 attempts" />
          </div>
        </div>

        <Column title="State and services">
          <Node brand="postgresql" title="Neon Postgres" sub="Authoritative ledger; one SQL function per decision" accent />
          <Node icon={<CpuIcon size={18} />} title="Model provider" sub="Groq, OpenAI-compatible; agent only" />
          <Node brand="ethereum" title="Robinhood Chain RPC" sub="Fee estimates, contract code checks" />
          <Node icon={<GaugeIcon size={18} />} title="Price feed" sub="Coinbase, Kraken fallback, 15 s cache" />
          <Node icon={<ZapIcon size={18} />} title="Bundler" sub="Alchemy, ERC-4337 (EntryPoint v0.7)" />
          <Node icon={<WalletIcon size={18} />} title="Safe smart accounts" sub="Threshold 2; Palisec co-signs, the Safe checks" accent />
          <Node icon={<KeyIcon size={18} />} title="Co-signers" sub="Server-held, one key per network" />
          <Node icon={<LockIcon size={18} />} title="Nitro enclave signer" sub="Mainnet co-signing" planned />
        </Column>
      </div>
      <figcaption id="map-cap" className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line px-5 py-3 text-[12.5px] text-muted sm:px-7">
        <span className="flex items-center gap-2"><span aria-hidden className="h-3 w-5 rounded-[3px] bg-aqua/[0.15]" />On the decision path</span>
        <span className="flex items-center gap-2"><span aria-hidden className="rounded-full px-1.5 font-utility text-[11px] font-semibold ring-1 ring-inset ring-line-strong">Planned</span>Not built yet</span>
      </figcaption>
    </figure>
  );
}

/* ───────── A request, in order ───────── */

const LIFECYCLE: { icon: ReactNode; title: string; body: string; where: string; tone?: "deny" | "review" | "allow" }[] = [
  { icon: <KeyIcon size={17} />, title: "Authenticate", body: "Scoped key looked up by SHA-256 hash; scope operations:write required.", where: "requireAgent()" },
  { icon: <SearchIcon size={17} />, title: "Validate", body: "Strict schema, chain, deadline and request ID. Unknown fields are rejected.", where: "zod schema" },
  { icon: <GaugeIcon size={17} />, title: "Gather inputs", body: "Active policy version, gas price, ETH/USD, target contract code. Missing means deny.", where: "chain-env.ts" },
  { icon: <CpuIcon size={17} />, title: "Evaluate twice", body: "Rust (WASM) and the TypeScript reference run the same checks in the same order.", where: "evaluateDual()", tone: "deny" },
  { icon: <DatabaseIcon size={17} />, title: "Commit atomically", body: "One SQL function takes a per-policy lock, re-checks budget, replay and loops, then writes.", where: "ps_record_operation()" },
  { icon: <HandIcon size={17} />, title: "Hold for approval", body: "Above the threshold, the operation waits for an EIP-712 signature on the exact payload.", where: "approvals.ts", tone: "review" },
  { icon: <FileCheckIcon size={17} />, title: "Answer and record", body: "Decision, reason code, policy version and authorization ID; an audit event in the same statement.", where: "audit_events", tone: "allow" },
  { icon: <BellIcon size={17} />, title: "Notify", body: "Webhooks and security detectors run after the response is sent, never before it.", where: "after()" },
  { icon: <WalletIcon size={17} />, title: "Execute on chain", body: "The agent signs the prepared Safe operation; Palisec co-signs once and the bundler submits it. The Safe checks both.", where: "/submit", tone: "allow" },
];

function Lifecycle() {
  return (
    <ol className="relative grid gap-x-10 lg:grid-cols-2">
      {LIFECYCLE.map((s, i) => {
        const ring = s.tone === "deny" ? "text-deny ring-deny/50" : s.tone === "review" ? "text-review ring-review/50" : s.tone === "allow" ? "text-allow ring-allow/50" : "text-aqua ring-aqua/40";
        return (
          <li key={s.title} className="relative flex gap-4 border-b border-line py-5 lg:[&:nth-last-child(-n+2)]:border-b-0">
            <span aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-abyss ring-1 ${ring}`}>{s.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-[16.5px] font-medium text-mist">
                  <span className="mr-2 font-mono text-[12px] text-dim">{String(i + 1).padStart(2, "0")}</span>
                  {s.title}
                </h3>
                <code className="font-mono text-[12px] text-muted">{s.where}</code>
              </div>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-silver">{s.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ───────── Data model ───────── */

const TABLES: { group: string; icon: ReactNode; tables: [string, string][] }[] = [
  {
    group: "Identity",
    icon: <UserCheckIcon size={17} />,
    tables: [
      ["users", "Wallet addresses that signed in"],
      ["auth_challenges", "One-use SIWE nonces"],
      ["sessions", "HttpOnly sessions, hashed"],
      ["organizations", "The tenant boundary"],
      ["memberships", "Role per user per organization"],
    ],
  },
  {
    group: "Policy and agents",
    icon: <ShieldIcon size={17} />,
    tables: [
      ["policies", "One per protected account"],
      ["policy_versions", "Immutable, hash-bound versions"],
      ["agents", "Registered agents and status"],
      ["api_credentials", "Scoped keys, SHA-256 hashed"],
    ],
  },
  {
    group: "Ledger",
    icon: <DatabaseIcon size={17} />,
    tables: [
      ["operations", "Each decision, its reservation and its execution"],
      ["audit_events", "Append-only; updates are refused"],
      ["security_findings", "Detector results with evidence"],
    ],
  },
  {
    group: "Connect",
    icon: <PlugIcon size={17} />,
    tables: [
      ["webhooks", "Endpoints; secrets AES-GCM encrypted"],
      ["webhook_deliveries", "Attempts with stable event IDs"],
    ],
  },
  {
    group: "Agent",
    icon: <AgentIcon size={17} />,
    tables: [
      ["agent_configurations", "Autonomy level, disabled tools"],
      ["agent_runs", "Stored conversations"],
      ["agent_tool_calls", "Every call, input and evidence"],
      ["agent_action_requests", "Actions waiting for a member"],
    ],
  },
];

/* ───────── Trust, failure, stack ───────── */

const TRUST: { c: string; level: "hostile" | "untrusted" | "fallible" | "critical" | "enforced"; s: string; icon: ReactNode }[] = [
  { c: "Agent or model", level: "untrusted", s: "No signing authority; every proposal is evaluated", icon: <AgentIcon size={16} /> },
  { c: "Public API input", level: "hostile", s: "Authentication, strict schemas, replay protection", icon: <GlobeIcon size={16} /> },
  { c: "Control-plane server", level: "fallible", s: "Cannot bypass on-chain checks once enforcement ships", icon: <ServerIcon size={16} /> },
  { c: "Policy engine", level: "critical", s: "Two implementations must agree; parity-tested", icon: <CpuIcon size={16} /> },
  { c: "Database", level: "fallible", s: "Atomic functions; unavailable means deny", icon: <DatabaseIcon size={16} /> },
  { c: "RPC and price feed", level: "untrusted", s: "Timeouts, fallbacks, fail closed", icon: <GaugeIcon size={16} /> },
  { c: "Human approver", level: "fallible", s: "Signs the exact payload and version", icon: <HandIcon size={16} /> },
  { c: "Smart account", level: "enforced", s: "Threshold 2: rejects anything Palisec did not co-sign", icon: <WalletIcon size={16} /> },
];
const LEVEL: Record<(typeof TRUST)[number]["level"], { text: string; cls: string }> = {
  hostile: { text: "Hostile", cls: "text-deny ring-deny/45" },
  untrusted: { text: "Untrusted", cls: "text-review ring-review/45" },
  fallible: { text: "May fail", cls: "text-silver ring-line-strong" },
  critical: { text: "Critical", cls: "text-aqua ring-aqua/45" },
  enforced: { text: "Boundary", cls: "text-allow ring-allow/45" },
};

const FAILURES: { icon: ReactNode; k: string; v: string }[] = [
  { icon: <DatabaseIcon size={17} />, k: "Database, price or fee unavailable", v: "Denied with PS_STATE_001 or PS_FEE_001. Unknown is never treated as zero or as allowed." },
  { icon: <CpuIcon size={17} />, k: "The two engines disagree", v: "Denied with PS_STATE_001, nothing reserved, and a policy_engine.fail_closed log line for investigation." },
  { icon: <AgentIcon size={17} />, k: "Model provider unavailable or rate-limited", v: "The run pauses with a clear message and can be continued. Authorization, SDKs, MCP and the console are unaffected." },
  { icon: <BanIcon size={17} />, k: "Invalid tool input from the model", v: "The call is refused and recorded as an error. Nothing is authorized or changed." },
  { icon: <BellIcon size={17} />, k: "Webhook receiver failing", v: "Three attempts with the same event ID, then marked failed for manual redelivery. Decisions are never delayed." },
  { icon: <ClockIcon size={17} />, k: "Approval expired or policy changed", v: "The approval is refused. The agent must propose again and a person must sign again." },
  { icon: <StopIcon size={17} />, k: "Emergency stop while agents are active", v: "Every new operation is denied at once. The Palisec Agent can explain the stop but cannot lift it." },
  { icon: <RepeatIcon size={17} />, k: "Duplicate or replayed request", v: "Same request ID returns the original decision; a replayed payload inside the window is denied." },
];

const STACK: { brand?: Brand; icon?: ReactNode; name: string; role: string; live: boolean }[] = [
  { brand: "nextdotjs", name: "Next.js 16", role: "Site, console and API routes", live: true },
  { brand: "vercel", name: "Vercel", role: "Hosting, serverless functions", live: true },
  { brand: "postgresql", name: "Neon Postgres", role: "Authoritative state, HTTPS driver", live: true },
  { brand: "rust", name: "Rust → WebAssembly", role: "Policy engine inside the API", live: true },
  { brand: "typescript", name: "TypeScript reference", role: "Second evaluator, SDK", live: true },
  { brand: "python", name: "Python SDK", role: "async client, web3.py sender", live: true },
  { brand: "modelcontextprotocol", name: "MCP SDK", role: "Streamable HTTP server", live: true },
  { icon: <CpuIcon size={20} />, name: "Groq", role: "Model for the Palisec Agent", live: true },
  { brand: "ethereum", name: "Safe 1.4.1 + 4337 module", role: "Smart accounts, mainnet and testnet", live: true },
  { icon: <ZapIcon size={20} />, name: "Alchemy bundler", role: "ERC-4337 submission", live: true },
  { icon: <LockIcon size={20} />, name: "AWS Nitro Enclaves", role: "Protected signing", live: false },
];

const MYTHS: [string, string][] = [
  ["A dropped transaction is an EVM revert.", "A denial happens before broadcast. It returns a structured error with a stable code and no transaction hash."],
  ["A gateway can protect a key it does not hold.", "Protection needs a smart account that enforces validation, or another cryptographic boundary."],
  ["Contracts can verify enclave attestation.", "Contracts trust a registered signer. Attestation binds that signer to a measured build, off chain."],
];


const ZERO = "0x0000000000000000000000000000000000000001";
/** Every check, read from the reference evaluator (it lists them all even when the first one denies). */
const ENGINE_CHECKS = evaluate(
  null,
  { request_id: "list", agent_id: "list", chain_id: 4663, from: ZERO, to: ZERO, value_wei: "0", data: "0x" } as unknown as Intent,
  EMPTY_STATE,
  { now: 0 } as unknown as Environment,
).checks;

export default function ArchitecturePage() {
  return (
    <>
      <LinePageHeader
        compat={`${SCHEMA_LABEL} · Robinhood Chain mainnet and testnet`}
        title="Decide off chain. Enforce on chain. Fail closed everywhere."
        lede="What runs where, the path of one request, what is stored, and what happens when something breaks."
      />

      <LineSection label="System map" intro="Everything that runs today, and the one piece still to come.">
        <SystemMap />
      </LineSection>

      <LineSection label="One request, in order" intro="POST /v1/operations, from key to webhook." className="border-y border-line bg-deep/40">
        <Lifecycle />
      </LineSection>

      <LineSection label="Two engines, one answer" id="engine">
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-center">
          <div className="space-y-4 text-[16px] leading-relaxed text-silver">
            <p>The Rust engine is compiled to WebAssembly and runs inside the API, next to the TypeScript reference evaluator. Both receive identical inputs.</p>
            <p>The decision counts only if they agree on every field: decision, reason code, every check and every reservation amount. A bug in either can only ever cause a denial.</p>
            <p className="flex items-center gap-2 text-[14px] text-muted">
              <CheckCircleIcon size={16} className="text-allow" /> Parity tested on shared fixtures and 6,000 random cases on every change.
            </p>
          </div>
          <figure aria-label="Dual evaluation" className="panel p-5 sm:p-7">
            <div className="grid grid-cols-2 gap-3">
              {[
                ["rust", "Rust engine", "WASM"],
                ["typescript", "Reference", "TypeScript"],
              ].map(([b, t, s]) => (
                <div key={t} className="rounded-[10px] border border-line-strong bg-deep p-4 text-center">
                  <BrandMark brand={b as Brand} size={26} className="mx-auto text-mist" />
                  <p className="mt-2.5 text-[14.5px] font-medium text-mist">{t}</p>
                  <p className="text-[12.5px] text-muted">{s}</p>
                </div>
              ))}
            </div>
            <div aria-hidden className="mx-auto my-3 grid h-8 w-px bg-line-strong" />
            <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-aqua/45 bg-aqua/[0.06] px-4 py-1.5 text-[13.5px] font-medium text-mist">
              <RepeatIcon size={15} className="text-aqua" /> Compare every field
            </div>
            <div aria-hidden className="mx-auto my-3 grid h-8 w-px bg-line-strong" />
            <div className="grid grid-cols-2 gap-3 text-[13.5px]">
              <p className="flex items-center justify-center gap-2 rounded-[10px] border border-allow/40 bg-allow/[0.06] px-3 py-2.5 text-allow">
                <CheckCircleIcon size={16} /> Match: their decision
              </p>
              <p className="flex items-center justify-center gap-2 rounded-[10px] border border-deny/40 bg-deny/[0.06] px-3 py-2.5 text-deny">
                <BanIcon size={16} /> Differ: PS_STATE_001
              </p>
            </div>
          </figure>
        </div>
      </LineSection>

      <LineSection label="Data model" intro="Postgres is the only source of truth. Five migrations, forward-only." className="border-y border-line bg-deep/40">
        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-[repeat(5,minmax(0,1fr))]">
          {TABLES.map((g) => (
            <div key={g.group} className="rounded-[12px] border border-line-strong bg-abyss/70">
              <p className="flex items-center gap-2 border-b border-line px-4 py-3 text-[14.5px] font-medium text-mist">
                <span aria-hidden className="text-aqua">{g.icon}</span>
                {g.group}
              </p>
              <ul className="divide-y divide-line">
                {g.tables.map(([t, d]) => (
                  <li key={t} className="px-4 py-2.5">
                    <code className="font-mono text-[12.5px] text-mist">{t}</code>
                    <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{d}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </LineSection>

      <LineSection label="Trust boundaries" intro="What each part is assumed to be, and what keeps it in check.">
        <ul className="grid gap-x-10 md:grid-cols-2">
          {TRUST.map((t) => (
            <li key={t.c} className="flex items-start gap-3 border-b border-line py-4">
              <span aria-hidden className="mt-0.5 text-silver">{t.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15.5px] font-medium text-mist">
                  {t.c}
                  <span className={`rounded-full px-2 py-0.5 font-utility text-[11.5px] font-semibold ring-1 ring-inset ${LEVEL[t.level].cls}`}>{LEVEL[t.level].text}</span>
                </p>
                <p className="mt-1 text-[14px] text-silver">{t.s}</p>
              </div>
            </li>
          ))}
        </ul>
      </LineSection>

      <LineSection label="Native agent runtime" id="agent-runtime" className="border-y border-line bg-deep/40">
        <div className="grid gap-10 2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <ul className="grid gap-6 md:grid-cols-3 2xl:grid-cols-1">
            {[
              [<ActivityIcon key="i" size={18} />, "Stored runs", "Each request advances a run by a few model steps within 45 seconds. Nothing waits open for a model or a person."],
              [<ShieldCheckIcon key="i" size={18} />, "Checked tools", "Role × autonomy × disabled tools decides what the model sees; the server checks again on every call."],
              [<HandIcon key="i" size={18} />, "Confirmed actions", "Actions become requests. A member confirms and they run through the console's own functions."],
            ].map(([icon, t, b]) => (
              <li key={t as string} className="flex gap-4">
                <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-raised/70 text-aqua ring-1 ring-inset ring-line-strong">{icon}</span>
                <div>
                  <p className="text-[16.5px] font-medium text-mist">{t}</p>
                  <p className="mt-1 text-[14.5px] leading-relaxed text-silver">{b}</p>
                </div>
              </li>
            ))}
          </ul>
          <pre className="panel overflow-x-auto p-5 font-mono text-[12.5px] leading-[1.9] text-soft">{`operator ─► run ─► model (Groq, OpenAI-compatible)
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
      </LineSection>

      <LineSection label="Every check, in order" id="checks" intro={`${ENGINE_CHECKS.filter((c) => c.enforcement === "local").length} checks run on every request in both engines, then ${ENGINE_CHECKS.filter((c) => c.enforcement === "live").length} on chain for a smart account. Any failure denies.`}>
        <ol className="divide-y divide-line border-y border-line font-mono text-[14px]">
          {ENGINE_CHECKS.map((c, i) => (
            <li key={c.id} className="grid grid-cols-[40px_1fr_auto] gap-3 py-3">
              <span className="text-dim">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-foam">{c.label}</span>
              <span className={c.enforcement === "live" ? "text-aqua" : "text-dim"}>{c.enforcement === "live" ? "on chain" : "every request"}</span>
            </li>
          ))}
        </ol>
      </LineSection>

      <LineSection label="When things break" id="failures" intro="Every failure ends in a denial or a pause, never a silent allow.">
        <div className="grid gap-3 lg:grid-cols-2">
          {FAILURES.map((f) => (
            <details key={f.k} className="group rounded-[12px] border border-line-strong bg-deep/60 open:border-aqua/35">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
                <span aria-hidden className="text-silver group-open:text-aqua">{f.icon}</span>
                <span className="flex-1 text-[15px] font-medium text-mist">{f.k}</span>
                <ChevronDownIcon size={16} className="text-dim transition-transform duration-300 group-open:rotate-180" />
              </summary>
              <p className="border-t border-line px-4 py-3.5 pl-12 text-[14.5px] leading-relaxed text-silver">{f.v}</p>
            </details>
          ))}
        </div>
      </LineSection>

      <LineSection label="Stack" className="border-y border-line bg-deep/40">
        <ul className="grid gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
          {STACK.map((s) => (
            <li key={s.name} className="flex items-center gap-4 bg-abyss px-5 py-4">
              <span aria-hidden className={s.live ? "text-mist" : "text-dim"}>
                {s.brand ? <BrandMark brand={s.brand} size={22} /> : s.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[15px] font-medium ${s.live ? "text-mist" : "text-muted"}`}>{s.name}</span>
                <span className="block text-[13px] text-muted">{s.role}</span>
              </span>
              <MaturityBadge maturity={s.live ? "service" : "specified"} />
            </li>
          ))}
        </ul>
      </LineSection>

      <LineSection label="Two rules" intro="A valid transaction is not an authorized one. Intelligence is not the authority. Enforcement is.">
        <span />
      </LineSection>

      <LineSection label="Common misconceptions">
        <ul className="divide-y divide-line border-y border-line">
          {MYTHS.map(([a, b]) => (
            <li key={a} className="grid gap-3 py-5 md:grid-cols-2 md:gap-10">
              <p className="flex items-start gap-3 text-[15.5px] text-silver line-through decoration-deny/60">
                <BanIcon size={17} className="mt-0.5 shrink-0 text-deny" />
                {a}
              </p>
              <p className="flex items-start gap-3 text-[15.5px] leading-relaxed text-mist">
                <CheckCircleIcon size={17} className="mt-0.5 shrink-0 text-allow" />
                {b}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-[14.5px] text-muted">
          Next: the <Link href="/security" className="text-aqua underline-offset-4 hover:underline">security model</Link> covers threats and key lifecycle.
        </p>
      </LineSection>
    </>
  );
}
