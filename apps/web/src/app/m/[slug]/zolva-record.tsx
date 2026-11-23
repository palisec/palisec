import { Section } from "@/components/ui";
import { publicZolvaForMandate } from "@/server/zolva";

/**
 * Zolva: the agent's track record from Zolva on its public page, only once the link is verified both
 * ways. Always labelled paper trading. Text from Zolva is rendered as text. Never an error: if Zolva or
 * the link cannot be read, the section is simply absent.
 */
const fmt = (v: number | null, unit: "%" | " points", sign = true) => (v === null ? "Unknown" : `${sign && v > 0 ? "+" : ""}${v.toFixed(2)}${unit}`);
const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

export async function ZolvaRecordSection({ slug }: { slug: string }) {
  const z = await publicZolvaForMandate(slug).catch(() => null);
  if (!z) return null;
  const { record: r, view: v } = z;
  const rows: [string, string][] = [
    ["Return since start", fmt(r.return_pct, "%")],
    ["Compared with simply holding", fmt(r.vs_holding_pts, " points")],
    ["Worst drop", r.max_drawdown_pct === null ? "Unknown" : `${r.max_drawdown_pct.toFixed(2)}%`],
    ["Trades", r.trades_count === null ? "Unknown" : String(r.trades_count)],
    [
      "Zolva's replay check",
      !v.verify ? "Unknown" : v.verify.status === "match" ? `Match, ${v.verify.hours_verified} hours verified` : v.verify.status === "differs" ? "Differs" : "No history yet",
    ],
  ];
  return (
    <Section label="Track record from Zolva">
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2 text-[14px] text-soft">
        <span className="rounded-[4px] border border-dashed border-review/60 px-1.5 py-0.5 font-utility text-[11.5px] text-review">Paper trading, virtual money</span>
        <span>
          Linked to the Zolva agent <a href={r.url} target="_blank" rel="noreferrer" className="text-mist underline decoration-line-strong underline-offset-4 hover:text-aqua">{r.name ?? "on Zolva"} ↗</a>. Each side names the
          other: this account declared it on chain, and Zolva names this account. The Zolva agent&apos;s trades are paper trades on Zolva; they do not run through Palisec.
        </span>
      </p>
      <dl className="grid grid-cols-[minmax(10rem,auto)_minmax(0,1fr)] gap-x-4 text-[14px]">
        {rows.map(([k, val]) => (
          <div key={k} className="contents">
            <dt className="border-b border-line py-2 text-muted">{k}</dt>
            <dd className="border-b border-line py-2 font-mono text-[13px] text-phosphor">{val}</dd>
          </div>
        ))}
      </dl>
      {r.decisions.length > 0 && (
        <ul className="divide-y divide-line text-[13px]">
          {r.decisions.slice(0, 5).map((d, i) => (
            <li key={i} className="grid grid-cols-[10rem_4.5rem_3.5rem_minmax(0,1fr)] gap-2 py-1.5">
              <span className="text-dim">{utc(d.at)}</span>
              <span className="font-mono text-[12px]">{d.market}</span>
              <span className="text-mist">{d.action}</span>
              <span className="break-words text-soft">{d.reasoning ?? ""}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12.5px] text-dim">
        {r.disclaimer} From Zolva&apos;s public API{v.as_of ? `, read ${utc(v.as_of)}` : ""}.
      </p>
    </div>
    </Section>
  );
}
