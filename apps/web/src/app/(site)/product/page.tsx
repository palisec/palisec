import type { Metadata } from "next";
import Link from "next/link";
import { Container, MaturityBadge, PageHeader, Section } from "@/components/ui";
import { CAPABILITIES } from "@/lib/capabilities";

export const metadata: Metadata = {
  title: "Product",
  description: "Six integrated products: authorization engine, protected signing, on-chain enforcement, SDKs, security control plane and developer platform.",
  alternates: { canonical: "/product" },
};

const PRODUCTS = [
  { n: "01", name: "Authorization engine", body: "Deterministic policy evaluation for transactions, UserOperations, spending, recipients, contracts and repeated actions.", cap: "engine" },
  { n: "02", name: "Protected signing service", body: "Policy-bound signing inside a TEE. The parent host cannot request a signature that skips evaluation.", cap: "enclave" },
  { n: "03", name: "On-chain account enforcement", body: "Smart-account validation that rejects operations without a valid Palisec authorization.", cap: "account" },
  { n: "04", name: "Developer SDK", body: "Typed clients for TypeScript (viem or ethers) and Python (web3.py), with no security logic of their own. Installed from palisec.tech.", cap: "sdk-ts" },
  { n: "05", name: "Security control plane", body: "Policy management, human approvals, API credentials, emergency stops and attestation verification, enforced server-side.", cap: "api" },
  { n: "06", name: "Developer platform", body: "This site and its documentation, the policy workbench, and the wallet-authenticated console for agents, policies, approvals and audit.", cap: "console" },
];

const RULES = [
  ["Capital and budget", "Per-transaction maximum, rolling hourly and daily spend, gas ceiling, per-token allocation, maximum exposure."],
  ["Rate limits and loops", "Repeated calldata, repeated intent fingerprints, requests per interval, per-agent quotas, cooldowns."],
  ["Contracts and methods", "Allowed chains, targets, code assumptions, function selectors, recipients, token allowlists."],
  ["Human authorization", "Value thresholds, new recipients, sensitive methods, overrides, independent signatures."],
  ["Emergency controls", "Pause an agent, revoke a key, disable a policy, pause an account, stop all authorization."],
];

const NON_GOALS = [
  "Replacing the EVM, the Robinhood Chain sequencer or Ethereum settlement.",
  "Protecting transactions that bypass the configured smart account or protected signing path.",
  "Claiming that a TEE prevents all compromise, side channels or supply-chain attacks.",
  "Building an AI model, agent framework, exchange or trading strategy.",
  "Storing private prompts, or requiring an LLM to disclose its reasoning.",
];

export default function ProductPage() {
  return (
    <>
      <PageHeader
        eyebrow="Product"
        title="An authorization boundary, not an RPC wrapper."
        lede="An agent may propose an action. Palisec evaluates it against explicit policies, state and spending limits before the protected account authorizes execution."
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
      <Section index="02" label="Rule types · v1">
        <dl className="divide-y divide-line border-y border-line">
          {RULES.map(([k, v]) => (
            <div key={k} className="grid gap-2 py-5 md:grid-cols-[260px_1fr]">
              <dt className="text-fg">{k}</dt>
              <dd className="text-sm leading-relaxed text-muted">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-sm text-muted">
          Schema 1.0 covers per-transaction, gas and hourly limits, allowlists, denylists, cooldowns and approval thresholds. See the{" "}
          <Link href="/docs/policies" className="text-fg underline decoration-line-strong underline-offset-4">policy reference</Link>.
        </p>
      </Section>
      <Section index="03" label="Not in the first release">
        <Container className="!px-0">
          <ul className="grid gap-px border border-line bg-line md:grid-cols-2">
            {NON_GOALS.map((g) => (
              <li key={g} className="flex gap-3 bg-ink p-5 text-sm leading-relaxed text-muted md:last:[&:nth-child(odd)]:col-span-2">
                <span aria-hidden className="font-mono text-dim">×</span>
                {g}
              </li>
            ))}
          </ul>
        </Container>
      </Section>
    </>
  );
}
