"use client";

import { useEffect, useState } from "react";
import { Result, type ResultKind } from "./parts";

interface Row {
  time: string;
  account: string;
  account_label: string;
  action: string;
  usd: number | null;
  result: ResultKind;
  reason_code: string | null;
  tx_hash: string | null;
  receipt_url: string | null;
}
interface Page { rows: Row[]; total: number; page: number; limit: number; as_of: string; stale: boolean }

const TABS = [
  { k: "all", label: "All" },
  { k: "allowed", label: "Allowed" },
  { k: "held", label: "Held" },
  { k: "blocked", label: "Blocked" },
];
const LIMIT = 25;
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

/** Every decision of the public demo accounts, 25 per page, from /api/v1/public/proof. */
export function ProofTable({ initial }: { initial: Page | null }) {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(initial);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (filter === "all" && page === 1 && initial) return;
    let cancelled = false;
    fetch(`/api/v1/public/proof?limit=${LIMIT}&page=${page}&result=${filter}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Page) => { if (!cancelled) { setData(d); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [filter, page, initial]);

  const pages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;
  return (
    <div>
      <div role="tablist" aria-label="Filter by result" className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.k}
            role="tab"
            aria-selected={filter === t.k}
            onClick={() => { setFilter(t.k); setPage(1); }}
            className={`lbtn sm ${filter === t.k ? "lbtn-primary" : "lbtn-ghost"}`}
          >
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>
      {failed && !data ? <p className="t-body">The decisions can&apos;t be read right now.</p> : null}
      {data ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-[0.9062rem] tabular-nums">
              <thead>
                <tr className="border-b border-line text-left text-[0.7188rem] uppercase tracking-[0.14em] text-dim">
                  <th className="py-3 pr-4 font-normal">Time (UTC)</th>
                  <th className="hidden py-3 pr-4 font-normal xl:table-cell">Account</th>
                  <th className="py-3 pr-4 font-normal">Action</th>
                  <th className="hidden py-3 pr-4 text-right font-normal sm:table-cell">USD</th>
                  <th className="py-3 pr-4 font-normal">Result</th>
                  <th className="py-3 font-normal">Link</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} className="border-b border-line">
                    <td className="whitespace-nowrap py-4 pr-4 text-dim">{r.time.replace("T", " ").slice(5, 19)}</td>
                    <td className="hidden py-4 pr-4 text-foam xl:table-cell" title={r.account}>{r.account_label}</td>
                    <td className="py-4 pr-4 text-foam">{r.action}</td>
                    <td className="hidden py-4 pr-4 text-right text-foam sm:table-cell">{r.usd === null ? "—" : r.usd.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                    <td className="py-4 pr-4"><Result kind={r.result}>{r.result === "allowed" ? "Allowed" : r.result === "held" ? "Held" : r.reason_code ?? "Blocked"}</Result></td>
                    <td className="py-4">{r.receipt_url && r.tx_hash ? <a href={r.receipt_url} target="_blank" rel="noopener noreferrer" className="text-silver hover:text-aqua">{short(r.tx_hash)} ↗</a> : <span className="text-dim">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 font-mono text-[0.8125rem] text-dim">
            <span>Showing {data.rows.length} of {data.total}{data.stale ? ` · Updated ${data.as_of.slice(11, 16)} UTC` : ""}</span>
            <span className="flex items-center gap-3">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="lbtn lbtn-ghost sm disabled:opacity-40"><span className="relative">← Newer</span></button>
              <span>{page} / {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="lbtn lbtn-ghost sm disabled:opacity-40"><span className="relative">Older →</span></button>
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}
