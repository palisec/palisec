import type { Metadata } from "next";
import Link from "next/link";
import { cacheLife } from "next/cache";
import { pageOpenGraph } from "@/lib/seo";
import { BILLING } from "@/lib/billing-config";
import { billingSettings, burnStats } from "@/server/billing";
import { mainnetEnabled } from "@/server/config";
import { AddressChip } from "@/components/line/address-chip";
import { Accent, Label, Result, Rows } from "@/components/line/parts";
import { Split } from "@/components/line/split";

export const metadata: Metadata = {
  title: "Token",
  description: "$PALISEC is used by the product: decision credits, burns through the credits contract, Pro limits for holders and holder votes on an agent's limits.",
  alternates: { canonical: "/token" },
  openGraph: pageOpenGraph("/token"),
};

/** The burn total is read from the chain at most every 5 minutes. */
async function burned(): Promise<string | null> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 300, expire: 86400 });
  try {
    const s = await burnStats();
    if (!s.configured) return null;
    const whole = BigInt(s.total_burned) / 10n ** 18n;
    return whole.toLocaleString("en-US");
  } catch {
    return null;
  }
}

export default async function TokenPage() {
  const total = await burned();
  // "Live" only where the code path is switched on in this deployment.
  const creditsLive = Boolean(billingSettings().contract) && mainnetEnabled();
  const pro = (BILLING.proHoldingTokens / 10n ** 18n).toLocaleString("en-US");
  const ROWS = [
    { k: "Credits", text: "Buy decision credits on chain through the credits contract.", live: creditsLive, href: "/docs/token" },
    { k: "Burns", text: "The credits contract burns $PALISEC, visible on chain.", live: creditsLive, href: "/docs/token" },
    { k: "Pro limits", text: `Hold ${pro} $PALISEC in the owner wallet for Pro limits.`, live: mainnetEnabled(), href: "/docs/token" },
    { k: "Holder votes", text: "Holders vote an agent's limits through mandates.", live: true, href: "/mandates" },
  ];
  return (
    <>
      <Split
        as="header"
        className="!pt-[150px]"
        left={
          <div className="space-y-8">
            <Label>Token</Label>
            {total !== null ? (
              <div>
                <p className="t-big">{total}</p>
                <p className="mt-3 font-mono text-[13px] uppercase tracking-[0.14em] text-dim">$PALISEC burned</p>
              </div>
            ) : null}
            <AddressChip />
          </div>
        }
        right={
          <div className="space-y-7">
            <h1 className="t-h1">$PALISEC, <Accent>used by the product.</Accent></h1>
            <p className="t-lede">Credits, burns, Pro limits and holder votes run on $PALISEC today.</p>
          </div>
        }
      />
      <Split
        left={<Label>What it does</Label>}
        right={
          <Rows>
            {ROWS.map((r) => (
              <li key={r.k}>
                <Link href={r.href} className="group grid gap-2 py-6 sm:grid-cols-[200px_1fr_auto] sm:items-baseline sm:gap-6">
                  <span className="font-utility text-[17px] font-medium text-mist group-hover:text-aqua">{r.k}</span>
                  <span className="t-body">{r.text}</span>
                  {r.live ? <Result kind="allowed">Live</Result> : <span />}
                </Link>
              </li>
            ))}
          </Rows>
        }
      />
    </>
  );
}
