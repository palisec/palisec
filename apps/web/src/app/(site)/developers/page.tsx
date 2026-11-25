import type { Metadata } from "next";
import Link from "next/link";
import { pageOpenGraph } from "@/lib/seo";
import { CodeBlock } from "@/components/copy-button";
import { Workbench } from "@/components/workbench";
import { Accent, Label } from "@/components/line/parts";
import { Split } from "@/components/line/split";
import { InstallTabs } from "@/components/line/install-tabs";

export const metadata: Metadata = {
  title: "Developers",
  description: "From zero to a protected transaction on mainnet: sign in, create the smart account, set the policy, install an SDK, check then send, handle approvals.",
  alternates: { canonical: "/developers" },
  openGraph: pageOpenGraph("/developers"),
};

const STEPS = [
  { title: "Sign in and create an organization.", body: "Sign in with your wallet. Your first sign-in creates an organization with you as owner.", href: "/docs/quickstart#hosted" },
  { title: "Create the smart account.", body: "A Safe with three owners: the agent's key, Palisec's co-signer and your recovery wallet.", href: "/docs/account-abstraction" },
  { title: "Set the policy.", body: "Allowed contracts and functions, spend and loss limits, the approval threshold. Then activate.", href: "/docs/policies" },
  { title: "Install an SDK.", body: "npm install @palisec/sdk or pip install palisec, with a key scoped to the agent.", href: "/docs/sdk/typescript" },
  { title: "Check, then send.", body: "Every transaction is checked first. Send only on ALLOW.", href: "/docs/api" },
  { title: "Handle approvals.", body: "Above the threshold a person signs; wait for it or poll.", href: "/docs/errors" },
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

export default function DevelopersPage() {
  return (
    <>
      <Split
        as="header"
        className="!pt-[150px]"
        left={
          <div className="space-y-6">
            <Label>Developers</Label>
            <ol className="divide-y divide-line border-y border-line">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <Link href={s.href} className="group grid grid-cols-[36px_1fr] gap-3 py-4">
                    <span className="font-mono text-[13px] text-dim">{String(i + 1).padStart(2, "0")}</span>
                    <span>
                      <span className="block font-utility text-[16px] font-medium text-mist group-hover:text-aqua">{s.title}</span>
                      <span className="mt-1 block text-[14.5px] leading-relaxed text-silver">{s.body}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        }
        right={
          <div className="space-y-7">
            <h1 className="t-h1">Integrate once. <Accent>Secure every execution.</Accent></h1>
            <p className="t-lede">From zero to a protected transaction on mainnet. Every snippet is the real SDK, tested against the live API.</p>
            <CodeBlock code={TS} title="agent.ts" />
            <InstallTabs />
          </div>
        }
      />
      <Split
        left={<Label>Workbench</Label>}
        right={
          <div className="space-y-8">
            <p className="t-lede">
              Try the policy engine in your browser. Live mode sends the same example to the testnet API as a dry run: nothing is reserved, signed or sent.
            </p>
            <Workbench />
          </div>
        }
      />
    </>
  );
}
