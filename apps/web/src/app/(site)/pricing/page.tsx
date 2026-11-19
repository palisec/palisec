import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import { Note, PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Developer, Production Swarm and Institutional plans for Palisec.",
  alternates: { canonical: "/pricing" }, openGraph: pageOpenGraph("/pricing"),
};

const PLANS = [
  {
    name: "Developer",
    price: "Free",
    body: "The hosted authorization API and live console on Robinhood Chain mainnet and testnet. 1,000 mainnet decisions per organization per month are included; after that, prepaid credits at $5 per 1,000 decisions, paid in USDG or ETH. Testnet and dry runs are always free.",
    items: ["1,000 mainnet decisions a month included", "Credits: $5 per 1,000 decisions (USDG or ETH)", "Pro limits when an owner wallet holds 5,000,000 $PALISEC", "Smart accounts enforced on chain"],
    note: "With no allowance or credits left, mainnet requests are refused (402 PS_CREDIT_001), never allowed unchecked. See Docs → Token.",
    available: true,
  },
  {
    name: "Production Swarm",
    price: "Monthly + usage",
    body: "Hosted policy enforcement, protected signing, audit history and usage-based metering.",
    items: ["Protected operation evaluations", "Successful signing operations", "Retained audit storage"],
    note: "Priced to your volume. Contact us on X @palisecagents.",
    available: false,
  },
  {
    name: "Institutional",
    price: "Contracted",
    body: "Dedicated capacity, defined service objectives, advanced access controls and negotiated support.",
    items: ["Dedicated capacity", "Defined objectives", "Advanced access control"],
    note: "Contract terms agreed with your team.",
    available: false,
  },
];

export default function PricingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Pricing"
        title="Metered on decisions and signatures."
        lede="Simple enough to understand, precise enough to reconcile with usage. Billing is tracked separately from authorization and can never bypass a check."
      />
      <Section label="Plans">
        <div className="grid gap-px border border-line bg-line lg:grid-cols-3">
          {PLANS.map((p) => (
            <article key={p.name} className="flex flex-col bg-ink p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-fg">{p.name}</h3>
                <span className={`inline-flex items-center gap-2 font-utility text-[13px] font-semibold ${p.available ? "text-allow" : "text-muted"}`}>
                  <span aria-hidden className={`h-2 w-2 rounded-full ${p.available ? "bg-allow" : "ring-1 ring-muted"}`} />
                  {p.available ? "Available" : "On request"}
                </span>
              </div>
              <p className="mt-6 font-heading text-[32px] font-medium tracking-[-0.03em] text-mist">{p.price}</p>
              <p className="mt-4 text-sm leading-relaxed text-muted">{p.body}</p>
              <ul className="mt-6 space-y-2 border-t border-line pt-4 text-[14.5px] text-soft">
                {p.items.map((i) => <li key={i} className="flex gap-3"><span aria-hidden className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-aqua" />{i}</li>)}
              </ul>
              <p className="mt-auto pt-8 text-[13px] text-muted">{p.note}</p>
            </article>
          ))}
        </div>
        <Note title="Overages">
          Exceeding an allowance never silently disables security checks: pending operations and reservations keep their
          guarantees, and the limits that apply are agreed in your plan.
        </Note>
      </Section>
    </>
  );
}
