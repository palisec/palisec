"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { shortHex } from "@/lib/units";

interface Burns {
  configured: boolean;
  contract?: string;
  total_burned?: string;
  purchases?: number;
  rows?: { tx_hash: string; block: string; burned: string; credits: string; usd_micros: string }[];
  checked_at?: string;
  explorer?: string;
  error?: string;
}

const fmt = (wei: string) => Number(formatUnits(BigInt(wei), 18)).toLocaleString("en-US", { maximumFractionDigits: 0 });

/** $PALISEC burned by the credits contract, read from the chain by /api/v1/token/burns. */
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
  if (!data.configured) return <p className="text-sm text-muted">The credits contract is not deployed on this deployment yet, so nothing has been burned.</p>;
  return (
    <div className="not-prose space-y-3">
      <div className="grid gap-px border border-line bg-line sm:grid-cols-2">
        <div className="bg-ink p-4">
          <p className="label">$PALISEC burned</p>
          <p className="mt-2 font-heading text-[28px] font-bold leading-none text-phosphor">{fmt(data.total_burned ?? "0")}</p>
        </div>
        <div className="bg-ink p-4">
          <p className="label">Credit purchases paid in $PALISEC</p>
          <p className="mt-2 font-heading text-[28px] font-bold leading-none text-phosphor">{data.purchases ?? 0}</p>
        </div>
      </div>
      {data.rows && data.rows.length > 0 && (
        <ul className="divide-y divide-line border border-line text-[13px]">
          {data.rows.map((r) => (
            <li key={r.tx_hash} className="flex flex-wrap justify-between gap-2 px-4 py-2">
              <a className="font-mono text-[12px] underline" href={`${data.explorer}/tx/${r.tx_hash}`} target="_blank" rel="noreferrer">{shortHex(r.tx_hash)}</a>
              <span className="text-soft">{fmt(r.burned)} Palisec for {Number(r.credits).toLocaleString("en-US")} credits</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12px] text-muted">
        Read from the chain{data.checked_at ? ` at ${data.checked_at.replace("T", " ").slice(0, 16)} UTC` : ""}: only burns made by the credits contract
        {data.contract ? <> (<a className="underline" href={`${data.explorer}/address/${data.contract}`} target="_blank" rel="noreferrer">{shortHex(data.contract)}</a>)</> : null} count; tokens holders sent to burn addresses themselves are not included.
      </p>
    </div>
  );
}
