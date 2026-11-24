import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import Link from "next/link";
import { CodeBlock } from "@/components/copy-button";
import { TerminalIcon } from "@/components/icons";
import { ButtonLink, PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = {
  title: "Developers",
  description: "Start building with PALISEC: install the SDK, authenticate, configure the account and policy, evaluate transactions, handle approvals, and connect over MCP or Python.",
  alternates: { canonical: "/developers" }, openGraph: pageOpenGraph("/developers"),
};

const STEPS: { n: string; title: string; body: string; href: string }[] = [
  { n: "01", title: "Sign in and create an organization", body: "Sign in with your wallet at /login. Your first sign-in creates an organization with you as owner.", href: "/docs/quickstart#hosted" },
  { n: "02", title: "Configure the account and policy", body: "Create a policy for the smart account your agent acts for, allow the contracts and selectors it needs, set the budget and approval threshold, then activate.", href: "/docs/policies" },
  { n: "03", title: "Register the agent and create a scoped key", body: "Bind the agent to the policy and create an API key with only the scopes it needs. The key is shown once.", href: "/docs/integrations" },
  { n: "04", title: "Install an SDK", body: "npm install @palisec/sdk or pip install palisec. Also served from palisec.tech.", href: "/docs/sdk/typescript" },
  { n: "05", title: "Evaluate, then propose", body: "Dry-run with evaluate, then authorize before every transaction. Send only on ALLOW.", href: "/docs/api" },
  { n: "06", title: "Handle approvals", body: "REQUIRES_HUMAN_SIGNATURE holds the operation until an approver signs. Wait for it, or return and poll.", href: "/docs/errors" },
];

const INSTALL = `# TypeScript (viem or ethers)
npm install @palisec/sdk viem

# Python 3.10+
pip install palisec

# Alternative, straight from palisec.tech:
# npm install https://palisec.tech/sdk/palisec-sdk-0.6.3.tgz viem
# pip install https://palisec.tech/sdk/palisec-0.4.8-py3-none-any.whl`;

const PY = `import os
from palisec import Palisec, PalisecDeniedError

async with Palisec(os.environ["PALISEC_API_KEY"]) as palisec:
    op = await palisec.transactions.evaluate(to=TOKEN, data=calldata, gas_limit=90_000)
    print(op.decision, op.reason_code)          # dry run: nothing reserved
    try:
        result = await palisec.send_transaction(sender, to=TOKEN, data=calldata, gas_limit=90_000)
    except PalisecDeniedError as e:
        print("refused:", e.code)               # nothing was sent`;

export default function DevelopersPage() {
  return (
    <>
      <PageHeader eyebrow="Developers" title="Integrate once. Secure autonomous execution." lede="Everything here runs on Robinhood Chain mainnet (4663) and testnet (46630). Every snippet is the real SDK, tested against the live API in CI.">
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/docs/quickstart">Quickstart</ButtonLink>
          <ButtonLink href="/console" variant="ghost" icon={<TerminalIcon size={17} />}>Console</ButtonLink>
        </div>
      </PageHeader>
      <Section label="From zero to a protected transaction">
        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n}>
              <Link href={s.href} className="panel flex h-full flex-col p-6 transition-colors hover:border-aqua/50">
                <span className="font-mono text-[12px] text-dim">{s.n}</span>
                <h3 className="mt-3 font-heading text-[19px] font-medium text-mist">{s.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-silver">{s.body}</p>
              </Link>
            </li>
          ))}
        </ol>
      </Section>
      <Section label="Installation">
        <CodeBlock code={INSTALL} title="terminal" />
      </Section>
      <Section label="Python integration">
        <CodeBlock code={PY} title="agent.py" />
      </Section>
      <Section label="References">
        <ul className="grid gap-px overflow-hidden rounded-[16px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["API reference", "/docs/api"],
            ["TypeScript SDK", "/docs/sdk/typescript"],
            ["Python SDK", "/docs/sdk/python"],
            ["MCP setup", "/docs/mcp"],
            ["Webhooks", "/docs/webhooks"],
            ["Policy schema", "/docs/policies"],
            ["Errors and reason codes", "/docs/errors"],
            ["Account abstraction", "/docs/account-abstraction"],
            ["PALISEC Agent", "/docs/agent"],
          ].map(([t, h]) => (
            <li key={h} className="bg-ink">
              <Link href={h} className="flex items-center justify-between p-5 text-[15px] text-mist transition-colors hover:bg-raised/60 hover:text-aqua">
                {t} <span aria-hidden className="text-dim">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
