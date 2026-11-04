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
    body: "The hosted authorization API and live console on Robinhood Chain Testnet, plus a policy workbench that evaluates examples in your browser.",
    items: ["Testnet authorization API and console", "Agents, policies, approvals and audit", "Policy workbench in the browser"],
    note: "Testnet only. Decisions are enforced for agents that call the API; nothing is signed or broadcast yet.",
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
      <Section index="01" label="Plans">
        <div className="grid gap-px border border-line bg-line lg:grid-cols-3">
          {PLANS.map((p) => (
            <article key={p.name} className="flex flex-col bg-ink p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-fg">{p.name}</h2>
                <span className={`font-mono text-[10px] tracking-[0.08em] ${p.available ? "text-soft" : "text-dim"}`}>
                  {p.available ? "● AVAILABLE" : "○ NOT YET OFFERED"}
                </span>
              </div>
              <p className="mt-6 font-mono text-2xl text-fg">{p.price}</p>
              <p className="mt-4 text-sm leading-relaxed text-muted">{p.body}</p>
              <ul className="mt-6 space-y-1.5 border-t border-line pt-4 font-mono text-[12px] text-soft">
                {p.items.map((i) => <li key={i}><span className="text-dim">— </span>{i}</li>)}
              </ul>
              <p className="mt-auto pt-8 text-xs text-muted">{p.note}</p>
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
