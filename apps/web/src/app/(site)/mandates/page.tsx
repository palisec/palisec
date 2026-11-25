import type { Metadata } from "next";
import Link from "next/link";
import { cacheLife } from "next/cache";
import { pageOpenGraph } from "@/lib/seo";
import { publicMandate } from "@/server/mandates";
import { Accent, Framed, Label, LineButton, Rows } from "@/components/line/parts";
import { PageHead, Split } from "@/components/line/split";

export const metadata: Metadata = {
  title: "Mandates",
  description: "An agent's token holders vote on its limits; when a vote passes, Palisec enforces the new limit on every transaction the agent proposes.",
  alternates: { canonical: "/mandates" },
  openGraph: pageOpenGraph("/mandates"),
};

const DEMO_SLUG = "palisec-demo";

/** The mandate demo's public state, read at most every 5 minutes. */
async function demoMandate() {
  "use cache";
  cacheLife({ stale: 300, revalidate: 300, expire: 86400 });
  try {
    return await publicMandate(DEMO_SLUG);
  } catch {
    return null;
  }
}

const ACTIONS = [
  ["set_max_transaction_usd", "Largest single transaction, in USD"],
  ["set_max_transaction_value", "Largest ETH value per transaction"],
  ["set_hourly_budget", "Hourly spend, ETH and tokens"],
  ["set_approval_threshold", "Above this, a person signs"],
  ["pause_risk", "Pause the agent"],
];

const utc = (iso: string) => `${iso.replace("T", " ").slice(0, 16)} UTC`;
const usd = (micros: unknown) => (micros == null ? "—" : `$${(Number(micros) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

export default async function MandatesPage() {
  const m = await demoMandate();
  const p = m?.proposals?.[0] ?? null;
  const tally = (p?.tally ?? null) as { for?: string; against?: string; for_bps?: number } | null;
  const forW = Number(tally?.for ?? 0);
  const againstW = Number(tally?.against ?? 0);
  const totalW = forW + againstW;
  const change = (p?.change ?? null) as { action?: string; value?: unknown; from?: unknown } | null;

  return (
    <>
      <PageHead
        label="Product · Mandates"
        title={<>Holders set the limits. <Accent>Palisec enforces them.</Accent></>}
        lede="An agent's token holders vote on its limits. When a vote passes, the new limit is enforced on every transaction the agent proposes."
      />

      <Split
        left={<div className="space-y-4"><Label>How a vote works</Label><p className="t-h3">The demo account&apos;s latest proposal.</p></div>}
        right={
          m ? (
            <Framed className="p-7">
              {p ? (
                <div className="space-y-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <p className="t-h3">#{p.number} · {p.title}</p>
                    <span className="font-mono text-[0.8125rem] text-silver">{p.state}</span>
                  </div>
                  {change?.action ? <p className="font-mono text-[0.875rem] text-aqua">{change.action}</p> : null}
                  {totalW > 0 ? (
                    <div>
                      <div className="mb-3 flex justify-between font-mono text-[0.7812rem] text-silver">
                        <span>for {Math.round((forW / totalW) * 100)}%</span>
                        <span>against {Math.round((againstW / totalW) * 100)}%</span>
                      </div>
                      <div className="flex h-2 overflow-hidden rounded-full bg-line">
                        <div className="h-full bg-aqua" style={{ width: `${(forW / totalW) * 100}%` }} />
                        <div className="h-full bg-deny/60" style={{ width: `${(againstW / totalW) * 100}%` }} />
                      </div>
                    </div>
                  ) : (
                    <p className="font-mono text-[0.8125rem] text-dim">No votes counted.</p>
                  )}
                  <Rows className="font-mono text-[0.8438rem]">
                    <li className="flex justify-between py-3"><span className="text-dim">Proposed</span><span className="text-foam">{utc(p.opens_at)}</span></li>
                    <li className="flex justify-between py-3"><span className="text-dim">Voting closes</span><span className="text-foam">{utc(p.closes_at)}</span></li>
                    {p.pending ? (
                      <li className="flex justify-between py-3"><span className="text-dim">{p.pending.state === "applied" ? "Enforced" : "Takes effect"}</span><span className="text-review">{utc(p.pending.effective_at)}</span></li>
                    ) : null}
                    <li className="flex justify-between py-3"><span className="text-dim">Enforced</span><span className="text-foam">{p.applied ? `policy v${p.policy_version}` : "not yet"}</span></li>
                  </Rows>
                </div>
              ) : (
                <div className="space-y-4 font-mono text-[0.875rem]">
                  <p className="text-silver">No proposal yet. Current mandate state:</p>
                  {m.active ? (
                    <Rows>
                      <li className="flex justify-between py-3"><span className="text-dim">Policy</span><span className="text-foam">v{m.active.version}</span></li>
                      <li className="flex justify-between py-3"><span className="text-dim">Hourly budget</span><span className="text-foam">{usd(m.active.hourly_budget_usd_micros)}</span></li>
                      <li className="flex justify-between py-3"><span className="text-dim">Approval above</span><span className="text-foam">{usd(m.active.approval_threshold_usd_micros)}</span></li>
                    </Rows>
                  ) : null}
                </div>
              )}
              <div className="mt-7">
                <LineButton href={`/m/${DEMO_SLUG}`} variant="ghost" small>The demo&apos;s mandate page →</LineButton>
              </div>
            </Framed>
          ) : (
            <div className="space-y-4">
              <p className="t-body">The demo mandate can&apos;t be read right now.</p>
              <LineButton href={`/m/${DEMO_SLUG}`} variant="ghost" small>The demo&apos;s mandate page →</LineButton>
            </div>
          )
        }
      />

      <Split
        left={<div className="space-y-4"><Label>What holders vote on</Label></div>}
        right={
          <div className="space-y-6">
            <Rows>
              {ACTIONS.map(([k, v]) => (
                <li key={k} className="grid gap-1 py-4 sm:grid-cols-[18.75rem_1fr] sm:gap-6">
                  <span className="font-mono text-[0.875rem] text-aqua">{k}</span>
                  <span className="t-body">{v}</span>
                </li>
              ))}
            </Rows>
            <p className="t-body text-silver">A vote to loosen a limit goes through the same public <Link href="/limits#delay" className="text-aqua hover:underline">delay</Link> as any other change.</p>
          </div>
        }
      />
    </>
  );
}
