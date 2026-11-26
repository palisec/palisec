import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatUnits } from "viem";
import { Countdown } from "@/components/line/countdown";
import { Framed, Label, Meter, Result, Rows } from "@/components/line/parts";
import { PageHead, Split } from "@/components/line/split";
import { publicTreasury, type PublicTreasury, type RecoveryState } from "@/server/public-treasury";

export const metadata: Metadata = {
  title: "Treasury guard",
  description: "The anti-rug rules on an agent's treasury, the lock date, sells against the daily cap, every blocked attempt and who could sign without Palisec. Read from the chain and Palisec's records.",
  robots: { index: false },
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const amount = (wei: string | null) => (wei === null ? "—" : Number(formatUnits(BigInt(wei), 18)).toLocaleString("en-US", { maximumFractionDigits: 2 }));
const utc = (iso: string) => iso.replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, "") + " UTC";

const RECOVERY_TITLE: Record<RecoveryState, string> = {
  timelock: "Fully bound",
  team_key: "The team can bypass these rules with its recovery key",
  contract: "Check the contract owner",
  not_enforced: "Not enforced on chain",
  unknown: "Owners could not be read",
};

export default function TreasuryPage({ params }: { params: Promise<{ account: string }> }) {
  return (
    <Suspense fallback={null}>
      <TreasuryBody params={params} />
    </Suspense>
  );
}

async function TreasuryBody({ params }: { params: Promise<{ account: string }> }) {
  await connection();
  const { account } = await params;
  let t: PublicTreasury;
  try {
    t = await publicTreasury(account);
  } catch {
    notFound();
  }
  const g = t.guard;
  const cap = t.cap === null ? null : BigInt(t.cap);
  const sold = BigInt(t.sold_24h);
  const pct = cap === null || cap === 0n ? 0 : Number((sold * 10000n) / cap) / 100;
  const bound = t.recovery.state === "timelock";
  const warn = t.recovery.state === "team_key" || t.recovery.state === "not_enforced";
  const link = (a: string) => (
    <a href={`${t.explorer}/address/${a}`} target="_blank" rel="noopener noreferrer" className="font-mono text-silver hover:text-aqua">{short(a)} ↗</a>
  );

  return (
    <>
      <PageHead
        label="Treasury guard"
        title={<>Anti-rug rules on {short(t.account)}</>}
        lede="Palisec co-signs every transaction this agent makes, and refuses anything that breaks these rules. The rules' hash is on chain, so you can check them without trusting us."
        left={<p className="font-mono text-[0.8125rem] text-dim">Robinhood Chain · policy v{t.policy_version}</p>}
      />

      <Split
        left={<Label>Who could sign without Palisec</Label>}
        right={
          <div className={`space-y-4 rounded-[0.875rem] border p-6 ${bound ? "border-allow/40" : warn ? "border-deny/50 bg-deny/[0.06]" : "border-review/50"}`} role={warn ? "alert" : undefined}>
            <Result kind={bound ? "allowed" : warn ? "blocked" : "held"}>{RECOVERY_TITLE[t.recovery.state]}</Result>
            <p className="t-body">{t.recovery.explanation}</p>
            {t.recovery.owners.length > 0 ? (
              <Rows>
                {t.recovery.owners.map((o) => (
                  <li key={o.address} className="flex flex-wrap items-center justify-between gap-3 py-3 font-mono text-[0.8125rem]">
                    <span className="text-foam">
                      {o.role === "palisec" ? "Palisec co-signer" : o.role === "contract" ? (o.min_delay_seconds !== null ? `Timelock (${Math.round(o.min_delay_seconds / 86400)}-day delay)` : "Contract owner") : "Key (agent or recovery owner)"}
                    </span>
                    {link(o.address)}
                  </li>
                ))}
              </Rows>
            ) : null}
            <p className="font-mono text-[0.75rem] text-dim">Threshold {t.recovery.threshold ?? "—"} of {t.recovery.owners.length || "—"}. <Link href="/docs/treasury-guard#fully-bound" className="underline hover:text-aqua">How to make it fully bound</Link></p>
          </div>
        }
      />

      <Split
        left={<Label>The rules</Label>}
        right={
          <Framed className="space-y-5 p-6">
            <dl className="grid gap-x-8 gap-y-4 font-mono text-[0.8438rem] sm:grid-cols-[12rem_1fr]">
              <dt className="text-dim">Project token</dt><dd>{link(g.project_token)}</dd>
              <dt className="text-dim">Sell venues</dt><dd className="flex flex-wrap gap-3">{g.allowed_sell_venues.length ? g.allowed_sell_venues.map((a) => <span key={a}>{link(a)}</span>) : "none"}</dd>
              <dt className="text-dim">Other destinations</dt><dd className="flex flex-wrap gap-3">{g.allowed_destinations.length ? g.allowed_destinations.map((a) => <span key={a}>{link(a)}</span>) : <span className="text-foam">none: the token goes nowhere else</span>}</dd>
              <dt className="text-dim">Daily sell cap</dt>
              <dd className="text-foam">
                {g.daily_sell_cap.amount !== null ? `${amount(g.daily_sell_cap.amount)} tokens` : null}
                {g.daily_sell_cap.amount !== null && g.daily_sell_cap.pct_of_holdings_bps !== null ? " or " : null}
                {g.daily_sell_cap.pct_of_holdings_bps !== null ? `${g.daily_sell_cap.pct_of_holdings_bps / 100}% of holdings` : null}
                {g.daily_sell_cap.amount === null && g.daily_sell_cap.pct_of_holdings_bps === null ? "none" : " per rolling 24 hours"}
              </dd>
              <dt className="text-dim">Approvals</dt><dd className="text-foam">Exact, to sell venues only, never unlimited</dd>
              <dt className="text-dim">Liquidity</dt><dd className="text-foam">{g.protect_liquidity ? `Protected (${g.lp_tokens.length} LP token${g.lp_tokens.length === 1 ? "" : "s"})` : "Not protected"}</dd>
              <dt className="text-dim">Locked until</dt>
              <dd className="text-foam">{g.locked_until > 0 ? <>{utc(new Date(g.locked_until * 1000).toISOString())} · <Countdown until={g.locked_until} /></> : "Not locked"}</dd>
            </dl>
          </Framed>
        }
      />

      <Split
        left={<Label>Sold today</Label>}
        right={
          <div className="space-y-4">
            <Meter name="Sold in the last 24 hours" value={cap === null ? `${amount(t.sold_24h)} (no cap)` : `${amount(t.sold_24h)} / ${amount(t.cap)}`} pct={pct} />
            <p className="font-mono text-[0.75rem] text-dim">Holdings before the window&apos;s sells: {amount(t.holdings)} · read {utc(t.as_of)}</p>
          </div>
        }
      />

      <Split
        left={<Label>On chain</Label>}
        right={
          t.commitment ? (
            <div className="space-y-3 font-mono text-[0.8125rem]">
              <p className="break-all text-foam">Policy hash {t.commitment.policy_hash} · version {t.commitment.version}</p>
              <p className="flex flex-wrap gap-4">
                <a href={`${t.explorer}/address/${t.commitment.registry}`} target="_blank" rel="noopener noreferrer" className="text-silver hover:text-aqua">ERC-8511 registry ↗</a>
                {t.commitment.policy_uri ? <a href={t.commitment.policy_uri} target="_blank" rel="noopener noreferrer" className="text-silver hover:text-aqua">Policy document ↗</a> : null}
                <Link href="/docs/treasury-guard#verify" className="text-aqua hover:underline">Verify it yourself</Link>
              </p>
            </div>
          ) : (
            <p className="t-body">This account has not published its policy to the registry yet.</p>
          )
        }
      />

      <Split
        left={<Label>Every attempt</Label>}
        right={
          t.events.length === 0 ? (
            <p className="t-body">No sells and no blocked attempts yet.</p>
          ) : (
            <table className="w-full font-mono text-[0.8438rem] tabular-nums">
              <thead>
                <tr className="border-b border-line text-left text-[0.7188rem] uppercase tracking-[0.14em] text-dim">
                  <th className="py-3 pr-4 font-normal">Time (UTC)</th>
                  <th className="py-3 pr-4 font-normal">Action</th>
                  <th className="py-3 pr-4 font-normal">Result</th>
                  <th className="hidden py-3 font-normal sm:table-cell">Proof</th>
                </tr>
              </thead>
              <tbody>
                {t.events.map((e) => (
                  <tr key={e.decision_id} className="border-b border-line align-top">
                    <td className="whitespace-nowrap py-3 pr-4 text-dim">{e.time.slice(5, 16).replace("T", " ")}</td>
                    <td className="py-3 pr-4 text-foam [overflow-wrap:anywhere]">{e.action}{e.sold ? ` · sold ${amount(e.sold)}` : ""}</td>
                    <td className="py-3 pr-4"><Result kind={e.result}>{e.result === "allowed" ? "Allowed" : e.reason_code ?? "Blocked"}</Result>{e.reason ? <span className="mt-1 block text-[0.75rem] text-dim">{e.reason}</span> : null}</td>
                    <td className="hidden py-3 sm:table-cell">
                      <span className="flex flex-col gap-1">
                        {e.tx_url ? <a href={e.tx_url} target="_blank" rel="noopener noreferrer" className="text-silver hover:text-aqua">Transaction ↗</a> : null}
                        {e.receipt_url ? <a href={e.receipt_url} target="_blank" rel="noopener noreferrer" className="text-silver hover:text-aqua">Signed receipt ↗</a> : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      />
    </>
  );
}
