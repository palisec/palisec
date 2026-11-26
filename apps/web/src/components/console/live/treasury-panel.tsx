"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUnits } from "@/lib/units";
import { KV, Mono, Panel, Pill } from "../kit";

interface Treasury {
  guard: { locked_until: number; daily_sell_cap: { amount: string | null; pct_of_holdings_bps: number | null } };
  sold_24h: string;
  cap: string | null;
  recovery: { state: string; explanation: string };
}

/** The treasury guard's state for an agent's account, from the same data as its public page. Hidden when there is no guard. */
export function TreasuryPanel({ account, chainId }: { account: string; chainId: number }) {
  const [t, setT] = useState<Treasury | null>(null);
  useEffect(() => {
    if (chainId !== 4663) return;
    let live = true;
    fetch(`/api/v1/public/treasury/${account}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setT(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [account, chainId]);
  if (!t) return null;
  const tokens = (v: string | null) => (v === null ? "—" : Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 2 }));
  const locked = t.guard.locked_until > 0 ? new Date(t.guard.locked_until * 1000).toISOString().replace(".000Z", "Z").replace("T", " ") : null;
  const bound = t.recovery.state === "timelock";
  return (
    <Panel title="Treasury guard" bodyClassName="space-y-3 p-4">
      <KV
        rows={[
          ["Sold, last 24 h", <Mono key="s" className="text-soft">{tokens(t.sold_24h)} / {t.cap === null ? "no cap" : tokens(t.cap)}</Mono>],
          ["Locked until", <Mono key="l" className="text-soft">{locked ? `${locked} UTC` : "not locked"}</Mono>],
          ["Recovery owner", <Pill key="r" tone={bound ? "allow" : "deny"}>{bound ? "fully bound" : t.recovery.state === "team_key" ? "team key can bypass" : t.recovery.state}</Pill>],
        ]}
      />
      <p className="text-[12px] text-muted">{t.recovery.explanation}</p>
      <Link href={`/r/${account}`} className="text-[12px] text-aqua underline underline-offset-4">Public page</Link>
    </Panel>
  );
}
