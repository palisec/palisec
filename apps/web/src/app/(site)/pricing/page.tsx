import type { Metadata } from "next";
import { Note, PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Sandbox, Production Swarm and Institutional plans for Palisec. Prices are not yet set.",
  alternates: { canonical: "/pricing" },
};

const PLANS = [
  {
    name: "Sandbox",
    price: "Free",
    body: "The hosted authorization API and live console on Robinhood Chain mainnet and testnet, plus a policy workbench that evaluates examples in your browser.",
    items: ["Authorization API and console, mainnet and testnet", "Smart accounts enforced on chain", "Agents, policies, approvals and audit"],
    note: "Free during pre-release. Decisions are enforced for agents that call the API; smart accounts are enforced on chain.",
    available: true,
  },
  {
    name: "Production Swarm",
    price: "Monthly + usage",
    body: "Hosted policy enforcement, protected signing, audit history and usage-based metering.",
    items: ["Protected operation evaluations", "Successful signing operations", "Retained audit storage"],
    note: "Prices and included limits not yet set.",
    available: false,
  },
  {
    name: "Institutional",
    price: "Contracted",
    body: "Dedicated capacity, defined service objectives, advanced access controls and negotiated support.",
    items: ["Dedicated capacity", "Defined objectives", "Advanced access control"],
    note: "Offered when these capabilities exist.",
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
                  {p.available ? "Available" : "Not yet offered"}
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
          Behaviour when a paid account exceeds its allowance, including how pending operations and reservations are handled, will
          be defined before launch. Exceeding an allowance never silently disables security checks.
        </Note>
      </Section>
    </>
  );
}
