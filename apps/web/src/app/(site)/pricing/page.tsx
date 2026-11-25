import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import { BILLING, LIMITS } from "@/lib/billing-config";
import { Accent, Label, LineButton } from "@/components/line/parts";
import { PageHead, Split } from "@/components/line/split";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Free to start, pay per decision: mainnet decisions included each month, then credits; with no allowance or credits left, mainnet requests are refused, never allowed unchecked.",
  alternates: { canonical: "/pricing" },
  openGraph: pageOpenGraph("/pricing"),
};

// Every number comes from lib/billing-config.ts.
const free = BILLING.freeDecisionsPerMonth.toLocaleString("en-US");
const perThousand = `$${(BILLING.priceUsdE6PerThousand / 1_000_000).toLocaleString("en-US")}`;
const pro = (BILLING.proHoldingTokens / 10n ** 18n).toLocaleString("en-US");

const PLANS = [
  {
    name: "Developer",
    price: "Free",
    body: `${free} mainnet decisions a month included. Then credits at ${perThousand} per 1,000 decisions, in USDG or ETH.`,
    items: [
      `${free} mainnet decisions a month included`,
      `Credits: ${perThousand} per 1,000 decisions (USDG or ETH)`,
      `Up to ${LIMITS.normal.agents} agents and ${LIMITS.normal.policies} policies; Pro limits when an owner wallet holds ${pro} $PALISEC`,
      "Smart accounts enforced on chain",
      "Testnet and dry runs always free",
    ],
    cta: { href: "/console", label: "Start building →", primary: true },
    highlight: true,
  },
  {
    name: "Production",
    price: "Monthly + usage",
    body: "Hosted policy enforcement, protected signing, audit history and usage-based metering, priced to your volume.",
    items: ["Protected operation evaluations", "Successful signing operations", "Retained audit storage"],
    cta: { href: "mailto:admin@palisec.tech", label: "Email admin@palisec.tech", primary: false },
    highlight: false,
  },
  {
    name: "Institutional",
    price: "Contracted",
    body: "Dedicated capacity, defined service objectives, advanced access controls and negotiated support.",
    items: ["Dedicated capacity", "Defined objectives", "Advanced access control"],
    cta: { href: "mailto:admin@palisec.tech", label: "Email admin@palisec.tech", primary: false },
    highlight: false,
  },
];

export default function PricingPage() {
  return (
    <>
      <PageHead
        label="Pricing"
        title={<>Free to start. <Accent>Pay per decision.</Accent></>}
        lede="A decision is one transaction checked. With no allowance or credits left, mainnet requests are refused, never allowed unchecked."
      />
      <Split
        left={<Label>Plans</Label>}
        right={
          <div className="grid gap-px overflow-hidden rounded-[0.875rem] border border-line bg-line lg:grid-cols-3">
            {PLANS.map((p) => (
              <div key={p.name} className={`flex flex-col gap-5 p-7 ${p.highlight ? "bg-[rgb(10_69_65/0.35)]" : "bg-abyss"}`}>
                <p className="t-label">{p.name}</p>
                <p className={`t-h3 ${p.highlight ? "text-aqua" : ""}`}>{p.price}</p>
                <p className="text-[0.9688rem] leading-relaxed text-foam">{p.body}</p>
                <ul className="space-y-2 border-t border-line pt-5 text-[0.9062rem] text-silver">
                  {p.items.map((i) => <li key={i}>· {i}</li>)}
                </ul>
                <div className="mt-auto pt-2">
                  <LineButton href={p.cta.href} variant={p.cta.primary ? "primary" : "ghost"} small>{p.cta.label}</LineButton>
                </div>
              </div>
            ))}
          </div>
        }
      />
    </>
  );
}
