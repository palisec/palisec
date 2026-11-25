import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { REGISTRY_ADDRESSES } from "policy-enforced-accounts";
import { pageOpenGraph } from "@/lib/seo";
import { NETWORKS, MAINNET } from "@/lib/networks";
import { publicFacts, publicProof, type ProofRow } from "@/server/public-data";
import { AddressChip } from "@/components/line/address-chip";
import { Closing, LimitsList, ProofReveal, Statement, TypedAddress, type LimitRowData } from "@/components/line/home-effects";
import { Accent, Label, LineButton, Result } from "@/components/line/parts";
import { Split } from "@/components/line/split";
import { Stream, type StreamItem } from "@/components/line/stream";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: pageOpenGraph("/"),
};

/** Live data is read at most every 5 minutes, so page views never each wake the database. */
async function homeData() {
  "use cache";
  cacheLife({ stale: 300, revalidate: 300, expire: 86400 });
  return Promise.all([publicFacts(), publicProof({ limit: 24, page: 1, result: "all" })]);
}

const EXPLORER = NETWORKS[MAINNET].explorer;
const REGISTRY_V3 = REGISTRY_ADDRESSES[MAINNET];

const LIMITS: LimitRowData[] = [
  { id: "spend", word: "Spend", text: "Caps per transaction and per hour, in USD. ETH and every token that leaves counts.", code: "PS_BUDGET_001", viz: "spend" },
  { id: "loss", word: "Loss", text: "Stops the agent when the account falls past the drop you set.", code: "PS_LOSS_001 · PS_LOSS_002", viz: "loss" },
  { id: "approve", word: "Approve", text: "Above your threshold, a person signs. Bound to that exact payload.", code: "PS_HUMAN_001", viz: "approve" },
  { id: "vote", word: "Vote", text: "Holders vote the limits. Palisec enforces the result.", code: "Holder mandates", viz: "vote" },
  { id: "stop", word: "Stop", text: "One switch stops every decision. A stop the account engaged stays held.", code: "PS_PAUSED_001", viz: "stop" },
  { id: "delay", word: "Delay", text: "Tightening applies at once. Loosening waits, in public.", code: "Loosening delay", viz: "delay" },
  { id: "assets", word: "Assets", text: "Taxes, traps and outputs that don't come back are caught before signing.", code: "Asset safety", viz: "assets" },
];

const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const usd = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const kindOf = (r: ProofRow): StreamItem["kind"] => (r.result === "allowed" ? "pass" : r.result === "held" ? "held" : "block");
const resultText = (r: ProofRow) => (r.result === "allowed" ? "Allowed" : r.result === "held" ? "Held" : r.reason_code ?? "Blocked");

function streamItem(r: ProofRow): StreamItem {
  const kind = kindOf(r);
  const amount = r.usd !== null ? ` · $${r.usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "";
  return {
    label: r.account_label,
    action: `${r.action}${amount}`,
    kind,
    tail: kind === "pass" ? (r.tx_hash ? short(r.tx_hash) : "allowed") : kind === "held" ? "PS_HUMAN_001 · Held for a person" : `${r.reason_code ?? "Blocked"}${r.reason ? ` · ${r.reason}` : ""}`,
    href: r.receipt_url,
  };
}

export default async function HomePage() {
  const [facts, proof] = await homeData();
  const rows = proof?.rows ?? [];
  // Oldest first, then looping. Fewer than 6 real decisions: no stream at all, never fake items.
  const stream = rows.length >= 6 ? [...rows].reverse().map(streamItem) : [];
  const counts =
    facts && facts.decisions_24h !== null && facts.allowed_24h !== null && facts.blocked_24h !== null
      ? { proposed: facts.decisions_24h, allowed: facts.allowed_24h, blocked: facts.blocked_24h }
      : null;
  const totals = [
    { id: "allowed", value: facts?.allowed_24h ?? null, label: "Allowed", cls: "text-allow" },
    { id: "blocked", value: facts?.blocked_24h ?? null, label: "Blocked, nothing signed", cls: "text-deny" },
    { id: "held", value: facts?.held_24h ?? null, label: "Held for a person", cls: "text-review" },
  ];
  const latest = rows.slice(0, 8);

  return (
    <>
      {/* 1. Hero */}
      <section className="relative min-h-[max(100dvh,47.5rem)] overflow-hidden" aria-labelledby="hero-title">
        <div className="split pt-[clamp(6.875rem,9vw,10.625rem)]">
          <div className="split-l order-2 min-w-0 space-y-10 lg:order-none lg:pt-[2.75rem]">
            {counts ? (
              <dl data-intro-counters className="grid grid-cols-[auto_1fr] gap-x-12 gap-y-1 font-mono text-[0.9375rem] leading-[2.1] text-silver">
                <dt className="sr-only">Proposed, last 24 h</dt>
                <dd data-counter className="font-medium tabular-nums text-mist">{counts.proposed.toLocaleString("en-US")}</dd>
                <dd>proposed</dd>
                <dt className="sr-only">Allowed, last 24 h</dt>
                <dd data-counter className="font-medium tabular-nums text-allow">{counts.allowed.toLocaleString("en-US")}</dd>
                <dd>allowed</dd>
                <dt className="sr-only">Blocked, last 24 h</dt>
                <dd data-counter className="font-medium tabular-nums text-deny">{counts.blocked.toLocaleString("en-US")}</dd>
                <dd>blocked at the line</dd>
              </dl>
            ) : null}
            <div data-intro-ctas className="flex flex-wrap gap-3">
              <LineButton href="/developers">Start building →</LineButton>
              <LineButton href="/proof" variant="ghost">See it live</LineButton>
            </div>
          </div>
          <div className="split-r order-1 min-w-0 lg:order-none">
            <h1 id="hero-title" className="t-hero">
              <span className="hero-ln"><span>Smart accounts</span></span>
              <span className="hero-ln"><span>with limits AI agents</span></span>
              <span className="hero-ln"><span className="text-aqua">can&apos;t override.</span></span>
            </h1>
            <p data-intro-sub className="t-lede mt-8 max-w-[48ch]">
              Agents propose. Palisec simulates every transaction, checks it against your limits and co-signs only what passes. On Robinhood Chain mainnet.
            </p>
          </div>
        </div>

        {stream.length ? (
          <>
            <Stream items={stream} counts={counts} />
            <div className="stream-static split mt-16 pb-16">
              <div className="split-l" />
              <ul className="split-r divide-y divide-line border-y border-line font-mono text-[0.875rem]">
                {rows.slice(0, 5).map((r, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                    <Result kind={r.result}>{resultText(r)}</Result>
                    <span className="text-silver">{r.action}</span>
                    {r.tx_hash ? <a href={r.receipt_url ?? undefined} target="_blank" rel="noopener noreferrer" className="text-dim hover:text-aqua">{short(r.tx_hash)}</a> : null}
                  </li>
                ))}
              </ul>
            </div>
            <p className="absolute bottom-6 hidden font-mono text-[0.75rem] text-dim lg:block" style={{ left: "calc(var(--line-x) + 5rem)" }}>
              Replaying the latest decisions from our public demo accounts
            </p>
            <div className="sr-only">
              <h2>Latest decisions from our public demo accounts</h2>
              <ul>
                {rows.slice(0, 8).map((r, i) => (
                  <li key={i}>{`${r.action}: ${resultText(r)}`}</li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
      </section>

      {/* 2. The line */}
      <Split left={<Label>The line</Label>} right={<Statement text="Everything left of the line is what an agent wants. Everything right of it is what actually lands on chain. Palisec is the line." />} />

      {/* 3. Limits */}
      <section className="split-section !pb-0" aria-labelledby="limits-title">
        <div className="split pb-10">
          <h2 id="limits-title" className="split-l t-label">What holds at the line</h2>
        </div>
        <LimitsList rows={LIMITS} />
      </section>

      {/* 4. Proof */}
      <ProofReveal totals={totals.map(({ id, value }) => ({ id, value }))}>
        <Split
          left={
            <div className="space-y-11">
              <Label>Proof · last 24 h</Label>
              {totals.map((t) =>
                t.value !== null ? (
                  <div key={t.id}>
                    <p className="t-big" data-total={t.id}>{t.value.toLocaleString("en-US")}</p>
                    <p className={`mt-3 font-mono text-[0.8125rem] uppercase tracking-[0.14em] ${t.cls}`}>{t.label}</p>
                  </div>
                ) : null,
              )}
            </div>
          }
          right={
            <div>
              <h2 className="t-h2">Every decision, <Accent>on the record.</Accent></h2>
              {latest.length ? (
                <div className="proof-rows mt-12 overflow-x-auto">
                  <table className="w-full font-mono text-[0.9062rem] tabular-nums">
                    <thead>
                      <tr className="border-b border-line text-left text-[0.7188rem] uppercase tracking-[0.14em] text-dim">
                        <th className="py-3 pr-4 font-normal">Time (UTC)</th>
                        <th className="hidden py-3 pr-4 font-normal xl:table-cell">Account</th>
                        <th className="py-3 pr-4 font-normal">Action</th>
                        <th className="hidden py-3 pr-4 text-right font-normal sm:table-cell">USD</th>
                        <th className="py-3 font-normal">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latest.map((r, i) => (
                        <tr key={i} className="proof-row border-b border-line" style={{ ["--i" as string]: i }}>
                          <td className="whitespace-nowrap py-4 pr-4 text-dim">{r.time.slice(11, 19)}</td>
                          <td className="hidden py-4 pr-4 text-foam xl:table-cell">{short(r.account)}</td>
                          <td className="py-4 pr-4 text-foam">
                            {r.receipt_url ? <a href={r.receipt_url} target="_blank" rel="noopener noreferrer" className="hover:text-aqua">{r.action}</a> : r.action}
                          </td>
                          <td className="hidden py-4 pr-4 text-right text-foam sm:table-cell">{usd(r.usd)}</td>
                          <td className="py-4"><Result kind={r.result}>{resultText(r)}</Result></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {proof?.stale ? <p className="mt-4 font-mono text-[0.75rem] text-dim">Updated {proof.as_of.slice(11, 16)} UTC</p> : null}
                </div>
              ) : null}
              <div className="mt-10"><LineButton href="/proof" variant="ghost" small>Every decision →</LineButton></div>
            </div>
          }
        />
      </ProofReveal>

      {/* 5. Standard */}
      <section className="split-section" aria-labelledby="standard-title">
        <div className="split">
          <div className="split-l min-w-0 space-y-6">
            <Label>ERC-8511</Label>
            <p className="t-h2">An open standard.</p>
          </div>
          <div className="split-r min-w-0 space-y-6">
            <h2 id="standard-title" className="t-h2 text-aqua">Check it without us.</h2>
            <p className="t-lede">Any account&apos;s active policy and stop state, read straight from the chain. No API, no trust in Palisec.</p>
          </div>
        </div>
        <div className="mt-[clamp(3.5rem,6vw,7.5rem)]">
          <TypedAddress address={REGISTRY_V3} href={`${EXPLORER}/address/${REGISTRY_V3}`} caption="Policy registry v3 · Robinhood Chain 4663 · interface 0xf594edcd" />
        </div>
      </section>

      {/* 6. Closing */}
      <section className="split-section" aria-label="Agents decide. Palisec enforces.">
        <Closing>
          <div className="split items-start gap-y-10">
            <div className="split-l min-w-0 space-y-8 lg:text-right">
              <p className="closing-l t-closing">Agents decide.</p>
              <div className="closing-f late space-y-3 lg:flex lg:flex-col lg:items-end">
                <AddressChip />
                <p className="font-mono text-[0.8125rem] text-dim">Free to start on mainnet</p>
              </div>
            </div>
            <div className="split-r min-w-0 space-y-8">
              <p className="closing-r t-closing text-aqua">Palisec enforces.</p>
              <div className="closing-f flex flex-wrap gap-3">
                <LineButton href="/developers">Start building →</LineButton>
                <LineButton href="/docs" variant="ghost">Docs</LineButton>
              </div>
            </div>
          </div>
        </Closing>
      </section>
    </>
  );
}
