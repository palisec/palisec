import type { Metadata } from "next";
import Link from "next/link";
import { pageOpenGraph } from "@/lib/seo";
import { Accent, Label } from "@/components/line/parts";
import { PageHead, Split } from "@/components/line/split";

export const metadata: Metadata = {
  title: "Limits",
  description: "Spend, loss, approval, simulation, asset safety, the loosening delay and the stop: limits counted in dollars on everything that leaves the account.",
  alternates: { canonical: "/limits" },
  openGraph: pageOpenGraph("/limits"),
};

const ROWS: { id: string; word: string; text: string; codes: string[]; doc: string }[] = [
  { id: "spend", word: "Spend", text: "Per-transaction cap and hourly budget, in USD. ETH and every token that leaves the account counts, priced through Chainlink.", codes: ["PS_BUDGET_001", "PS_PRICE_001"], doc: "/docs/policies" },
  { id: "loss", word: "Loss", text: "Stops the agent when the account falls past the drop you set, in percent or in dollars.", codes: ["PS_LOSS_001", "PS_LOSS_002", "PS_LOSS_003"], doc: "/docs/policies" },
  { id: "approve", word: "Approve", text: "Above your threshold, a person signs. The approval is bound to that exact payload.", codes: ["PS_HUMAN_001"], doc: "/docs/policies" },
  { id: "simulate", word: "Simulate", text: "Every transaction is simulated first. If Palisec can't see what leaves the account, it doesn't sign.", codes: ["PS_SIM_002"], doc: "/docs/policies" },
  { id: "assets", word: "Assets", text: "Sell taxes, honeypots and swaps whose output doesn't come back to the account are caught before signing.", codes: ["Asset safety"], doc: "/docs/policies" },
  { id: "delay", word: "Delay", text: "Tightening applies at once. Loosening waits, in public, so nobody can quietly raise a limit.", codes: ["Loosening delay"], doc: "/docs/policies" },
  { id: "stop", word: "Stop", text: "One switch stops every decision. A stop the account engaged stays held until the account lifts it.", codes: ["PS_PAUSED_001", "PS_STATE_001"], doc: "/docs/standard" },
];

export default function LimitsPage() {
  return (
    <>
      <PageHead
        label="Product · Limits"
        title={<>Limits counted in dollars, <Accent>on everything that leaves.</Accent></>}
        lede="Palisec simulates each transaction, sees every token and every bit of ETH that would leave the account, prices it, and checks it against your limits before it co-signs."
      />
      <section className="split-section !pb-0" aria-label="Limits">
        {ROWS.map((r) => (
          <div key={r.id} id={r.id} className="scroll-mt-28 border-t border-line">
            <div className="split py-10">
              <div className="split-l min-w-0 space-y-3">
                <p className="t-body text-foam">{r.text}</p>
                <p className="flex flex-wrap gap-x-3 font-mono text-[0.8125rem]">
                  {r.codes.map((c) =>
                    c.startsWith("PS_") ? (
                      <Link key={c} href={`/docs/errors#${c}`} className="text-aqua hover:underline">{c}</Link>
                    ) : (
                      <span key={c} className="text-aqua">{c}</span>
                    ),
                  )}
                </p>
              </div>
              <div className="split-r min-w-0">
                <Link href={r.doc} className="t-giant text-mist transition-colors hover:text-aqua">{r.word}</Link>
              </div>
            </div>
          </div>
        ))}
      </section>
      <Split
        left={<Label>Fail closed</Label>}
        right={<p className="t-h2">If Palisec can&apos;t price it or can&apos;t see it, <Accent>it doesn&apos;t sign.</Accent></p>}
      />
    </>
  );
}
