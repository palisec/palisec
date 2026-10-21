import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CSSProperties } from "react";
import Link from "next/link";
import {
  EMPTY_STATE,
  EXAMPLE_ENV,
  EXAMPLE_POLICY,
  SCENARIOS,
  evaluate,
} from "@palisec/policy-schema";
import { BoundaryDiagram } from "@/components/boundary-diagram";
import { Constellation } from "@/components/constellation";
import { CodeBlock } from "@/components/copy-button";
import { CubeGlyph } from "@/components/cube";
import { HeroScene } from "@/components/hero-scene";
import { Marquee } from "@/components/marquee";
import { Reveal, TypeOut } from "@/components/motion";
import { ReversalBand } from "@/components/reversal-band";
import { ButtonLink, Container, DecisionBadge, MaturityBadge, Section } from "@/components/ui";
import { Workbench } from "@/components/workbench";
import { capability } from "@/lib/capabilities";

/** Brand media is optional: use it only if it has been added to /public/media. */
const media = (file: string) => (existsSync(join(process.cwd(), "public", "media", file)) ? `/media/${file}` : undefined);

const HEADLINE = ["The deterministic", "boundary between", "AI intent and", "on-chain execution."];

const PROOF = [
  {
    cap: "reservations",
    title: "Stateful budget enforcement",
    body: "Per-transaction, hourly and gas limits are checked against a serialized reservation ledger, not a dashboard counter. Five concurrent requests for the last slot produce one reservation and four denials.",
    spec: ["Integer wei, never floats", "Rolling 3600 s window", "Reservation TTL + idempotency"],
    href: "/docs/policies#budgets",
  },
  {
    cap: "schema",
    title: "Contract and method allowlisting",
    body: "Targets are denied by default. Each allowlisted contract names its permitted 4-byte selectors and whether verified code is required. An explicit deny always overrides an allow.",
    spec: ["Default: deny", "Selector-level rules", "Unknown method → review or deny"],
    href: "/docs/policies#contracts",
  },
  {
    cap: "enclave",
    title: "Protected signing, auditable approval",
    body: "Signatures come only from a policy-bound signer the smart account recognises. Approvals bind to the exact operation hash, policy version and expiry.",
    spec: ["No arbitrary-signing endpoint", "One-time, expiring approvals", "Append-only audit trail"],
    href: "/security",
  },
] as const;

const LIFECYCLE = [
  { plane: "Gateway", steps: ["Authenticate caller", "Validate request schema", "Replay + deadline check"] },
  { plane: "Enforcement", steps: ["Resolve active policy", "Target, method, value rules", "Fee + price bounds", "Atomic budget reservation", "Loop detection", "Decide"] },
  { plane: "Signing", steps: ["Simulate execution", "Bind to op hash + expiry", "Sign in enclave"] },
  { plane: "Chain", steps: ["Smart-account validation", "Bundler submission", "Reconcile receipt"] },
];

const SDK_SNIPPET = `import { palisec } from "@palisec/sdk";

const wall = palisec({
  apiKey: process.env.PALISEC_API_KEY!,
  chainId: 4663,
});

const result = await wall.operations.create({
  account: "0x1111…1111",       // protected ERC-4337 account
  to: "0x3333…3333",            // allowlisted router
  value: 40_000_000_000_000_000n,
  data: swapCalldata,
  idempotencyKey: crypto.randomUUID(),
});

switch (result.decision) {
  case "ALLOW":                    // authorized; submission tracked separately
    await wall.operations.waitForReceipt(result.operationId);
    break;
  case "REQUIRES_HUMAN_SIGNATURE": // pending; nothing signed yet
    await wall.approvals.waitFor(result.approvalId);
    break;
  case "DENY":                     // terminal; never broadcast
    throw new PalisecDenied(result.reasonCode);
}`;

export default function Home() {
  // A real evaluation by the local reference evaluator, computed at build time.
  const swap = SCENARIOS.find((s) => s.id === "swap")!;
  const sample = evaluate(
    EXAMPLE_POLICY,
    { ...swap.intent, request_id: "rw_req_example", deadline: EXAMPLE_ENV.now + 120 },
    EMPTY_STATE,
    EXAMPLE_ENV,
  );
  const sampleJson = JSON.stringify(
    {
      request_id: sample.request_id,
      decision: sample.decision,
      reason_code: sample.reason_code,
      policy_id: sample.policy_id,
      policy_version: sample.policy_version,
      authorization_id: sample.authorization_id,
      transaction_hash: sample.transaction_hash,
      retryable: sample.retryable,
    },
    null,
    2,
  );
  const clusters = media("cubes-left.png") && media("cubes-right.png") ? { left: "/media/cubes-left.png", right: "/media/cubes-right.png" } : undefined;

  return (
    <>
      {/* ───────── Hero: cube above headline, orbiting check nodes ───────── */}
      <section aria-labelledby="hero-title" className="relative -mt-[76px] min-h-[100svh] overflow-hidden">
        <HeroScene videoSrc={media("hero-cube.mp4")} />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-carbon from-40% via-carbon/80 to-transparent" />
        <Container className="relative flex min-h-[100svh] flex-col items-center pb-16 pt-[60vh] text-center sm:pb-20 sm:pt-[52vh] lg:pt-[56vh]">
          <p className="label mb-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 animate-[fade-up_.8s_ease-out_both]">
            {["Robinhood Chain", "Chain ID 4663", "EVM authorization layer"].map((t, i) => (
              <span key={t} className="flex items-center gap-2 !text-citrine">
                {i > 0 && <span className="text-smoke">·</span>}
                {t}
              </span>
            ))}
          </p>
          <h1 id="hero-title" className="display text-bone">
            {HEADLINE.map((line, i) => (
              <span key={line} className="line-mask" style={{ "--d": `${150 + i * 110}ms` } as CSSProperties}>
                <span>{line}</span>
              </span>
            ))}
          </h1>
          <p className="mt-8 max-w-[560px] text-base leading-relaxed text-stone animate-[fade-up_.9s_ease-out_.7s_both] sm:text-lg">
            Enforce transaction policies, spending limits, and approval requirements before autonomous agents execute on Robinhood Chain.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3 animate-[fade-up_.9s_ease-out_.9s_both]">
            <ButtonLink href="/architecture">Read the Architecture</ButtonLink>
            <ButtonLink href="/docs/sdk/typescript" variant="ghost">Explore the SDK</ButtonLink>
          </div>
          <a href="#enforcement" className="mt-14 flex flex-col items-center gap-2 text-[10px] font-medium uppercase tracking-[0.08em] text-stone hover:text-citrine">
            Scroll
            <span className="relative h-10 w-px overflow-hidden bg-graphite">
              <span className="absolute inset-x-0 top-0 h-1/2 bg-citrine animate-[scan_1.8s_ease-in-out_infinite]" />
            </span>
          </a>
        </Container>
      </section>

      {/* ───────── Invariants marquee (no customer logos: there are none yet) ───────── */}
      <div className="border-y border-graphite py-6">
        <Marquee items={["Fail closed", "Deterministic", "Deny overrides allow", "Never broadcast on deny", "Integer wei", "Atomic reservations", "Replay protected", "Human approval bound to op hash", "No arbitrary signing"]} />
      </div>

      {/* ───────── Split feature: text 40 / constellation 60 ───────── */}
      <Section index="01" label="The engine" id="enforcement">
        <div className="grid items-center gap-16 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-20">
          <div>
            <Reveal>
              <h2 id="enforcement-title" className="heading text-bone">Rules a program executes. Not warnings a model interprets.</h2>
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-8 max-w-[560px] leading-relaxed text-stone">
                Every proposed action runs the same fifteen checks in the same order. The same policy, request and state always
                produce the same decision and the same reason code.
              </p>
            </Reveal>
            <Reveal delay={220}>
              <p className="mt-4 max-w-[560px] leading-relaxed text-stone">
                Anything failed, ambiguous, timed-out or unverifiable ends in no signature. Unavailable fees are never zero; a
                missing policy is never allow-all.
              </p>
            </Reveal>
            <Reveal delay={320}>
              <div className="mt-10 font-mono text-sm text-bone">
                <TypeOut text="> evaluate(policy, intent, state, env)" />
              </div>
            </Reveal>
          </div>
          <Reveal delay={150}>
            <Constellation />
          </Reveal>
        </div>
      </Section>

      {/* ───────── Boundary + proof ───────── */}
      <Section index="02" label="Enforcement">
        <div className="grid items-center gap-16 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-20">
          <Reveal>
            <BoundaryDiagram />
          </Reveal>
          <div>
            <Reveal>
              <h2 className="heading text-bone">Three exits. One of them is a wall.</h2>
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-8 max-w-[560px] leading-relaxed text-stone">
                Allowed operations continue to the smart account. Operations that cross a threshold wait for a human, unsigned.
                Denied operations stop at the boundary: no signature, no broadcast, no transaction hash.
              </p>
            </Reveal>
          </div>
        </div>

        <ol className="mt-24 grid gap-x-12 gap-y-16 border-t border-graphite pt-16 md:grid-cols-3">
          {PROOF.map((p, i) => (
            <Reveal key={p.title} as="li" delay={i * 120} className="group flex flex-col">
              <div className="mb-8 flex items-center justify-between gap-3">
                <span className="text-[12px] font-medium tracking-[0.032em] text-smoke transition-colors group-hover:text-citrine">{String(i + 1).padStart(2, "0")}</span>
                <MaturityBadge maturity={capability(p.cap).maturity} />
              </div>
              <h3 className="text-[24px] font-medium leading-[1.2] tracking-[-0.01em] text-bone">{p.title}</h3>
              <p className="mt-4 leading-relaxed text-stone">{p.body}</p>
              <ul className="mt-6 space-y-2">
                {p.spec.map((s) => (
                  <li key={s} className="flex items-center gap-3 text-[12px] font-medium uppercase tracking-[0.032em] text-citrine">
                    <span className="h-1 w-1 bg-citrine" />
                    {s}
                  </li>
                ))}
              </ul>
              <Link href={p.href} className="mt-auto inline-flex items-center gap-2 pt-8 text-[12px] font-medium uppercase tracking-[0.032em] text-bone hover:text-citrine">
                Implementation detail
                <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
              </Link>
            </Reveal>
          ))}
        </ol>
      </Section>

      {/* ───────── Workbench ───────── */}
      <Section index="03" label="Policy workbench" id="workbench">
        <div className="mb-14 grid gap-8 lg:grid-cols-2 lg:items-end">
          <Reveal>
            <h2 id="workbench-title" className="heading text-bone">Put a transaction against the wall.</h2>
          </Reveal>
          <Reveal delay={120}>
            <p className="max-w-[560px] leading-relaxed text-stone">
              The canonical schema and evaluation order, running in your browser on illustrative data. Checks that need a live
              protected account are listed and explicitly not run.
            </p>
          </Reveal>
        </div>
        <Reveal delay={100}>
          <Workbench />
        </Reveal>
      </Section>

      {/* ───────── The one cream reversal ───────── */}
      <ReversalBand clusterImages={clusters}>
        <Reveal>
          <p className="mb-8 text-[12px] font-medium uppercase tracking-[0.032em] text-ash">Smart-account enforcement</p>
        </Reveal>
        <h2 className="display mx-auto max-w-[15ch] text-carbon">
          {["A gateway", "can't guard", "a key it", "doesn't hold."].map((l, i) => (
            <Reveal key={l} as="span" delay={i * 90} className="block">{l}</Reveal>
          ))}
        </h2>
        <Reveal delay={400}>
          <p className="mx-auto mt-8 max-w-[520px] leading-relaxed text-ash">
            The protected path is an ERC-4337 account whose validation rejects any operation without a valid Palisec authorization.
            Plain EOA forwarding is a convenience, never a boundary.
          </p>
        </Reveal>
        <Reveal delay={500}>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/docs/account-abstraction" variant="dark">Account abstraction</ButtonLink>
            <ButtonLink href="/architecture" variant="ghost-dark">Architecture</ButtonLink>
          </div>
        </Reveal>
      </ReversalBand>

      {/* ───────── Integration ───────── */}
      <Section index="04" label="Integration">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-16">
          <Reveal>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[24px] font-medium text-bone">One protected execution call.</h2>
              <MaturityBadge maturity={capability("sdk-ts").maturity} />
            </div>
            <p className="max-w-[560px] leading-relaxed text-stone">
              Approval, signing, submission, inclusion and success are separate states. The SDK returns a discriminated union and
              never treats a pending approval as permission.
            </p>
            <CodeBlock code={SDK_SNIPPET} title="agent.ts · proposed @palisec/sdk" pseudo />
          </Reveal>
          <Reveal delay={150}>
            <div className="mb-6 flex items-center justify-between gap-3">
              <p className="label">Evaluation result</p>
              <DecisionBadge decision={sample.decision} />
            </div>
            <p className="leading-relaxed text-stone">
              Real output of the local reference evaluator for the swap above, computed at build time.{" "}
              <code className="font-mono text-sm text-citrine">transaction_hash</code> is null: nothing was broadcast.
            </p>
            <CodeBlock code={sampleJson} title="response.json · local evaluator" />
            <ol className="space-y-0">
              {sample.checks.filter((c) => c.enforcement === "local").map((c, i) => (
                <Reveal key={c.id} as="li" delay={i * 40} className="flex justify-between gap-4 border-b border-graphite py-1.5 text-[12px]">
                  <span className="truncate text-stone">{c.label}</span>
                  <span className="font-medium tracking-[0.032em] text-citrine">{c.status.toUpperCase()}</span>
                </Reveal>
              ))}
            </ol>
          </Reveal>
        </div>
      </Section>

      {/* ───────── Lifecycle ───────── */}
      <Section index="05" label="Request lifecycle">
        <Reveal>
          <h2 className="heading max-w-[18ch] text-bone">Off-chain decision. On-chain enforcement.</h2>
        </Reveal>
        <div className="relative mt-16">
        <div aria-hidden className="absolute left-0 right-0 top-[19px] hidden h-px bg-graphite xl:block">
          <Reveal className="draw-x h-full w-full bg-citrine/70">
            <span />
          </Reveal>
        </div>
        <ol className="relative grid gap-12 md:grid-cols-2 xl:grid-cols-4 xl:gap-8">
          {LIFECYCLE.map((p, i) => (
            <Reveal key={p.plane} as="li" delay={i * 180} className="relative">
              <div className="mb-6 flex items-center gap-4">
                <span className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full border border-graphite bg-carbon">
                  <CubeGlyph size={14} />
                </span>
                <span className="label relative z-10 bg-carbon pr-4 !text-bone">{String.fromCharCode(65 + i)} · {p.plane}</span>
              </div>
              <ol className="space-y-2.5">
                {p.steps.map((s) => (
                  <li key={s} className="border-l border-graphite pl-4 text-sm text-stone transition-colors hover:border-citrine hover:text-bone">{s}</li>
                ))}
              </ol>
            </Reveal>
          ))}
        </ol>
        </div>
      </Section>

      {/* ───────── Network: no telemetry yet, so say so ───────── */}
      <Section index="06" label="Network">
        <div className="grid gap-16 lg:grid-cols-2">
          <Reveal>
            <p className="text-[12px] font-medium uppercase tracking-[0.032em] text-sand">◆ Metrics unavailable</p>
            <h2 className="mt-6 text-[24px] font-medium leading-tight text-bone">No deployment, so no numbers.</h2>
            <p className="mt-4 max-w-[480px] leading-relaxed text-stone">
              Block height, latency and transaction counts appear here only when backed by real telemetry and a published
              measurement definition.
            </p>
            <Link href="/status" className="mt-8 inline-block text-[12px] font-medium uppercase tracking-[0.032em] text-bone hover:text-citrine">Status page →</Link>
          </Reveal>
          <Reveal delay={150}>
            <dl className="divide-y divide-graphite border-y border-graphite text-sm">
              {[
                ["Network", "Robinhood Chain"],
                ["Mainnet chain ID", "4663"],
                ["Testnet chain ID", "46630"],
                ["Verification", "Pending authoritative network config"],
                ["Entry point", "Pending ERC-4337 confirmation"],
                ["Fee model", "Pending RPC fee confirmation"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-6 py-3.5">
                  <dt className="text-stone">{k}</dt>
                  <dd className={`text-right font-mono text-[13px] ${v.startsWith("Pending") ? "text-sand" : "text-bone"}`}>{v}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </Section>

      {/* ───────── Final CTA ───────── */}
      <Section>
        <div className="flex flex-col items-center text-center">
          <Reveal>
            <h2 className="display max-w-[14ch] text-bone">Read how it works before you trust it.</h2>
          </Reveal>
          <Reveal delay={200}>
            <div className="mt-12 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/docs/quickstart">Read the Quickstart</ButtonLink>
              <ButtonLink href="/security" variant="ghost">Review the Security Model</ButtonLink>
            </div>
          </Reveal>
        </div>
      </Section>
    </>
  );
}
