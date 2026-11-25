"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { shortHex } from "@/lib/units";

interface Burns {
  configured: boolean;
  contract?: string | null;
  burn_wallet?: string | null;
  burn_wallet_balance?: string;
  contract_burned?: string;
  burnfrom_burned?: string;
  contract_logs_complete?: boolean;
  total_burned?: string;
  percent_of_supply?: number;
  purchases?: number;
  rows?: { tx_hash: string; block: string; burned: string; credits: string; usd_micros: string }[];
  checked_at?: string;
  explorer?: string;
  error?: string;
}

const fmt = (wei: string) => Number(formatUnits(BigInt(wei), 18)).toLocaleString("en-US", { maximumFractionDigits: 0 });

/** $PALISEC burned: the burn wallet's balance plus burns by the credits contract, read by /api/v1/token/burns. */
export function BurnCounter() {
  const [data, setData] = useState<Burns | null>(null);
  useEffect(() => {
    fetch("/api/v1/token/burns")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ configured: true, error: "The chain could not be read right now." }));
  }, []);
  if (!data) return <p className="text-sm text-muted">Reading the chain…</p>;
  if (data.error) return <p className="text-sm text-muted">{data.error}</p>;
  const ex = data.explorer;
  return (
    <div className="not-prose space-y-3">
      <div className="grid gap-px border border-line bg-line sm:grid-cols-3">
        <div className="bg-ink p-4">
          <p className="label">$PALISEC burned</p>
          <p className="mt-2 font-heading text-[1.75rem] font-bold leading-none text-phosphor">{fmt(data.total_burned ?? "0")}</p>
        </div>
        <div className="bg-ink p-4">
          <p className="label">Share of minted supply</p>
          <p className="mt-2 font-heading text-[1.75rem] font-bold leading-none text-phosphor">{(data.percent_of_supply ?? 0).toFixed(2)}%</p>
        </div>
        <div className="bg-ink p-4">
          <p className="label">Burned with burnFrom</p>
          <p className="mt-2 font-heading text-[1.75rem] font-bold leading-none text-phosphor">{fmt(data.burnfrom_burned ?? "0")}</p>
        </div>
      </div>
      <ul className="divide-y divide-line border border-line text-[0.8125rem]">
        {data.burn_wallet ? (
          <li className="flex flex-wrap justify-between gap-2 px-4 py-2">
            <a className="font-mono text-[0.75rem] underline" href={`${ex}/address/${data.burn_wallet}`} target="_blank" rel="noreferrer">Burn wallet {shortHex(data.burn_wallet)}</a>
            <span className="text-soft">{fmt(data.burn_wallet_balance ?? "0")} Palisec</span>
          </li>
        ) : null}
        {(data.rows ?? []).map((r) => (
          <li key={r.tx_hash} className="flex flex-wrap justify-between gap-2 px-4 py-2">
            <a className="font-mono text-[0.75rem] underline" href={`${ex}/tx/${r.tx_hash}`} target="_blank" rel="noreferrer">{shortHex(r.tx_hash)}</a>
            <span className="text-soft">{fmt(r.burned)} Palisec for {Number(r.credits).toLocaleString("en-US")} credits</span>
          </li>
        ))}
      </ul>
      <p className="text-[0.75rem] text-muted">
        Read from the chain{data.checked_at ? ` at ${data.checked_at.replace("T", " ").slice(0, 16)} UTC` : ""}: {data.burn_wallet ? "the burn wallet’s balance plus " : ""}burnFrom burns (the drop in total supply below the 1,000,000,000 minted), including the credits contract
        {data.contract ? <> (<a className="underline" href={`${ex}/address/${data.contract}`} target="_blank" rel="noreferrer">{shortHex(data.contract)}</a>)</> : null}.
        {data.contract && data.contract_logs_complete === false ? " The contract's burns could not be read this time, so only the wallet is counted." : ""}
      </p>
    </div>
  );
}
