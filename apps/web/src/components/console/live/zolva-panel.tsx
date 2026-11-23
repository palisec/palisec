"use client";

import { useCallback, useEffect, useState } from "react";
import { Btn, Field, inputCls, KV, Mono, Notice, Panel, Pill, type Tone } from "../kit";
import { utc } from "./common";
import { api } from "./session";

/**
 * Zolva: the agent's track record from Zolva (paper trading, virtual money), the two-sided link, the
 * on-chain declaration the account's owners execute, bigger limits once proven, and a replay of this
 * agent's policy against the Zolva record. Display only: nothing here changes a decision or a signature.
 * Everything from Zolva is rendered as text.
 */
interface Record_ {
  id: string;
  name: string | null;
  strategy: string | null;
  markets: string[];
  venue: string | null;
  disclaimer: string;
  start_capital_usd: number | null;
  value_usd: number | null;
  return_pct: number | null;
  holding_return_pct: number | null;
  vs_holding_pts: number | null;
  max_drawdown_pct: number | null;
  trades_count: number | null;
  hours_run: number | null;
  last_run_at: string | null;
  url: string;
  equity: [number, number, number][];
  decisions: { at: string; market: string; action: string; reasoning: string | null }[];
}
interface View {
  zolva_agent_id: string | null;
  link: { palisec_side: string; declared_id: string | null; zolva_side: string; account_enforced: boolean | null; verified: boolean; label: string } | null;
  record: Record_ | null;
  verify: { status: "match" | "differs" | "no_history"; verified_since: string | null; hours_verified: number; first_difference: string | null } | null;
  as_of: string | null;
  verify_as_of: string | null;
  unavailable: string | null;
  declaration: { to: string; data: string; from_account: string; function: string; args: { service: string; id: string }; note: string } | null;
  proven: { unlocked_at: string | null; pending_effective_at: string | null } | null;
}
interface ReplayRow { at: string; market: string; side: string; size_usd: number; decision: string; reason_code: string | null; check: string | null; detail: string }
interface Replay {
  policy: { id: string; version: number | null; which: string };
  trades: number;
  replayed: number;
  allowed: number;
  blocked: number;
  review: number;
  by_reason: Record<string, number>;
  rows: ReplayRow[];
  assumptions: string[];
  disclaimer: string;
}

const UNKNOWN = <span className="text-dim">Unknown</span>;
const pct = (v: number | null, sign = true) => (v === null ? UNKNOWN : <span className="text-phosphor">{`${sign && v > 0 ? "+" : ""}${v.toFixed(2)}%`}</span>);
const pts = (v: number | null) => (v === null ? UNKNOWN : <span className="text-phosphor">{`${v > 0 ? "+" : ""}${v.toFixed(2)} points`}</span>);
const usd = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const PAPER = <Pill tone="review">Paper trading, virtual money</Pill>;

function Chart({ equity }: { equity: [number, number, number][] }) {
  if (equity.length < 2) return null;
  const w = 560;
  const h = 120;
  const xs = equity.map((r) => r[0]);
  const ys = equity.flatMap((r) => [r[1], r[2]]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const px = (x: number) => ((x - x0) / Math.max(1, x1 - x0)) * (w - 8) + 4;
  const py = (y: number) => h - 6 - ((y - y0) / Math.max(1e-9, y1 - y0)) * (h - 12);
  const line = (i: 1 | 2) => equity.map((r) => `${px(r[0]).toFixed(1)},${py(r[i]).toFixed(1)}`).join(" ");
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[120px] w-full" role="img" aria-label="Seven days of hourly value: the agent against simply holding">
        <polyline points={line(2)} fill="none" stroke="var(--color-line-strong)" strokeWidth="1.5" strokeDasharray="4 3" />
        <polyline points={line(1)} fill="none" stroke="var(--color-phosphor)" strokeWidth="1.75" />
      </svg>
      <figcaption className="flex gap-4 text-[11.5px] text-dim">
        <span><span className="text-phosphor">━</span> Agent value</span>
        <span><span className="text-silver">┅</span> Simply holding</span>
        <span>7 days, hourly, UTC</span>
      </figcaption>
    </figure>
  );
}

const sideTone = (s: string): Tone => (s === "verified" ? "allow" : s === "different" ? "deny" : "review");

export function ZolvaPanel({ agentId, canEdit }: { agentId: string; canEdit: boolean }) {
  const [v, setV] = useState<View | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [which, setWhich] = useState<"active" | "draft">("active");
  const [capital, setCapital] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<View>(`/agents/${agentId}/zolva`)
      .then((r) => {
        setV(r);
        setFailed(false);
        setDraft(r.zolva_agent_id ?? "");
      })
      .catch(() => setFailed(true));
  }, [agentId]);
  useEffect(load, [load]);

  const save = (id: string | null) =>
    api(`/agents/${agentId}/zolva`, id ? { method: "PUT", body: { zolva_agent_id: id } } : { method: "DELETE" })
      .then(() => {
        setMsg(id ? "Linked on Palisec. Declare it on chain below." : "Unlinked.");
        setReplay(null);
        load();
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : "Could not save"));

  const runReplay = () => {
    setBusy(true);
    api<Replay>(`/agents/${agentId}/zolva/replay`, { method: "POST", body: { version: which, ...(capital ? { capital_usd: Number(capital) } : {}) } })
      .then((r) => setReplay(r))
      .catch((e) => setMsg(e instanceof Error ? e.message : "Replay failed"))
      .finally(() => setBusy(false));
  };

  const rec = v?.record ?? null;
  const link = v?.link ?? null;
  return (
    <Panel title={<span className="flex flex-wrap items-center gap-2">Track record from Zolva {PAPER}</span>} bodyClassName="p-4 space-y-4">
      {failed && <Notice tone="review">The Zolva status could not be loaded. Nothing about this agent&apos;s decisions depends on it.</Notice>}
      {v && !v.zolva_agent_id && <p className="text-[13px] text-muted">No Zolva agent linked. Zolva publishes AI trading agents&apos; paper-trading records; linking shows that record here and on the agent&apos;s public page once both sides confirm the link.</p>}

      {v?.zolva_agent_id && (
        <>
          <KV
            rows={[
              ["Link", link ? <Pill key="l" tone={link.verified ? "allow" : link.zolva_side === "different" || link.palisec_side === "different" ? "deny" : "review"}>{link.label}</Pill> : UNKNOWN],
              ["Declared on chain by this account", link ? <Pill key="p" tone={sideTone(link.palisec_side === "declared" ? "verified" : link.palisec_side)}>{{ declared: "Yes", not_declared: "Not yet", different: "A different Zolva agent", unavailable: "Unknown" }[link.palisec_side] ?? link.palisec_side}</Pill> : UNKNOWN],
              ["Confirmed by Zolva", link ? <Pill key="z" tone={sideTone(link.zolva_side === "confirmed" ? "verified" : link.zolva_side)}>{{ confirmed: "Yes", waiting: "Waiting for Zolva to confirm", different: "Zolva names a different account", unavailable: "Unknown" }[link.zolva_side] ?? link.zolva_side}</Pill> : UNKNOWN],
              ["Account enforced by Palisec", link?.account_enforced === null || !link ? UNKNOWN : link.account_enforced ? "Yes" : "No"],
              ["Zolva agent", rec ? <a key="a" href={rec.url} target="_blank" rel="noreferrer" className="text-mist underline decoration-line-strong underline-offset-4 hover:text-aqua">{rec.name ?? "Unnamed agent"} on Zolva ↗</a> : <Mono key="m">{v.zolva_agent_id}</Mono>],
            ]}
          />
          <p className="text-[12px] text-dim">Linked means each side names the other. It does not mean the Zolva agent&apos;s trades run through Palisec: Zolva&apos;s record is paper trading with virtual money.</p>

          {v.declaration && link?.palisec_side !== "declared" && (
            <div className="space-y-2 rounded-[6px] border border-line p-3">
              <p className="text-[13px] text-soft">Declare it on chain: this account (the Safe) calls <Mono>setLink</Mono> on the AgentLinks contract. Its owners sign it like any Safe transaction. It records the Zolva agent ID and moves no funds.</p>
              <KV
                rows={[
                  ["From (the account)", <Mono key="f">{v.declaration.from_account}</Mono>],
                  ["To (AgentLinks)", <Mono key="t">{v.declaration.to}</Mono>],
                  ["Value", "0"],
                  ["Data", <Mono key="d" className="break-all">{v.declaration.data}</Mono>],
                ]}
              />
            </div>
          )}

          {rec && (
            <div className="space-y-3">
              <KV
                rows={[
                  ["Return since start", pct(rec.return_pct)],
                  ["Compared with simply holding", pts(rec.vs_holding_pts)],
                  ["Worst drop", rec.max_drawdown_pct === null ? UNKNOWN : <span className="text-phosphor">{`${rec.max_drawdown_pct.toFixed(2)}%`}</span>],
                  ["Trades", rec.trades_count === null ? UNKNOWN : String(rec.trades_count)],
                  ["Hours run", rec.hours_run === null ? UNKNOWN : String(rec.hours_run)],
                  ["Strategy and markets", `${rec.strategy ?? "Unknown"} · ${rec.markets.join(", ") || "none"} · ${rec.venue ?? ""}`],
                  [
                    "Zolva's replay check",
                    !v.verify ? UNKNOWN : v.verify.status === "match" ? (
                      <Pill key="r" tone="allow">{`Match${v.verify.verified_since ? ` since ${utc(v.verify.verified_since)}` : ""}, ${v.verify.hours_verified} hours verified`}</Pill>
                    ) : v.verify.status === "differs" ? (
                      <Pill key="r" tone="deny">{`Differs${v.verify.first_difference ? ` from ${utc(v.verify.first_difference)}` : ""}`}</Pill>
                    ) : (
                      <Pill key="r" tone="muted">No history yet</Pill>
                    ),
                  ],
                ]}
              />
              <Chart equity={rec.equity} />
              {rec.decisions.length > 0 && (
                <div>
                  <h4 className="mb-1 font-utility text-[12px] text-muted">Latest decisions, with Zolva&apos;s reasons (UTC)</h4>
                  <ul className="divide-y divide-line text-[12.5px]">
                    {rec.decisions.slice(0, 10).map((d, i) => (
                      <li key={i} className="grid grid-cols-[9.5rem_4.5rem_3.5rem_minmax(0,1fr)] gap-2 py-1.5">
                        <span className="text-dim">{utc(d.at)}</span>
                        <Mono>{d.market}</Mono>
                        <span className={d.action === "hold" ? "text-muted" : "text-mist"}>{d.action}</span>
                        <span className="break-words text-soft">{d.reasoning ?? ""}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[12px] text-dim">
                {rec.disclaimer} Source: Zolva&apos;s public API{v.as_of ? `, read ${utc(v.as_of)}` : ""}. Zolva publishes new data once an hour.
              </p>
            </div>
          )}
          {v.unavailable && <Notice tone="review">{v.unavailable}{v.as_of ? ` Last read ${utc(v.as_of)}.` : " Nothing read yet."}</Notice>}

          {v.proven && (
            <p className="text-[12.5px] text-muted">
              Bigger limits once proven on Zolva:{" "}
              {v.proven.unlocked_at ? <span className="text-allow">unlocked since {utc(v.proven.unlocked_at)}</span> : v.proven.pending_effective_at ? <span className="text-review">pending, takes effect {utc(v.proven.pending_effective_at)} unless cancelled</span> : "locked (the policy's own limits apply)"}
              . Applies only if this agent&apos;s policy has a <Mono>proven_record</Mono> section.
            </p>
          )}

          <div className="space-y-2 border-t border-line pt-3">
            <h4 className="font-utility text-[13px] text-mist">Test this agent&apos;s policy against the Zolva record</h4>
            <p className="text-[12.5px] text-muted">Replays the policy with both engines against Zolva&apos;s recorded trades and shows which it would have blocked, with the reason. Read only: nothing is recorded, signed or sent.</p>
            <div className="flex flex-wrap items-end gap-2">
              <Field id={`zr-which-${agentId}`} label="Policy version">
                <select id={`zr-which-${agentId}`} className={inputCls} value={which} onChange={(e) => setWhich(e.target.value === "draft" ? "draft" : "active")}>
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                </select>
              </Field>
              <Field id={`zr-cap-${agentId}`} label="Scale to account size (USD, optional)">
                <input id={`zr-cap-${agentId}`} className={inputCls} inputMode="decimal" value={capital} onChange={(e) => setCapital(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 500" />
              </Field>
              <Btn onClick={runReplay} disabled={busy}>{busy ? "Replaying…" : "Replay"}</Btn>
            </div>
            {replay && (
              <div className="space-y-2">
                <p className="text-[13px] text-soft">
                  {replay.policy.id} ({replay.policy.which}): {replay.replayed} of {replay.trades} trades replayed · <span className="text-allow">{replay.allowed} allowed</span> · <span className="text-deny">{replay.blocked} blocked</span> · <span className="text-review">{replay.review} held for a person</span>
                  {Object.keys(replay.by_reason).length > 0 && <> · {Object.entries(replay.by_reason).map(([k, n]) => `${k} ×${n}`).join(", ")}</>}
                </p>
                <div className="max-h-[320px] overflow-auto">
                  <table className="w-full text-left text-[12px]">
                    <thead className="text-dim">
                      <tr><th className="py-1 pr-2 font-normal">Time (UTC)</th><th className="pr-2 font-normal">Trade</th><th className="pr-2 font-normal">Size</th><th className="pr-2 font-normal">Decision</th><th className="font-normal">Why</th></tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {replay.rows.map((r, i) => (
                        <tr key={i} className="align-top">
                          <td className="py-1 pr-2 text-dim">{utc(r.at)}</td>
                          <td className="pr-2"><Mono>{`${r.side} ${r.market}`}</Mono></td>
                          <td className="pr-2">{usd(r.size_usd)}</td>
                          <td className="pr-2"><Pill tone={r.decision === "ALLOW" ? "allow" : r.decision === "DENY" ? "deny" : r.decision === "NOT_REPLAYED" ? "muted" : "review"}>{r.decision === "REQUIRES_HUMAN_SIGNATURE" ? "REVIEW" : r.decision === "NOT_REPLAYED" ? "not replayed" : r.decision}</Pill>{r.reason_code ? <Mono className="ml-1 text-muted">{r.reason_code}</Mono> : null}</td>
                          <td className="break-words text-soft">{r.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="list-disc space-y-0.5 pl-5 text-[11.5px] text-dim">{replay.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
              </div>
            )}
          </div>
        </>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <Field id={`zolva-${agentId}`} label="Zolva agent ID" hint="From the agent's page on zolvaagent.app. Linking shows its record here; the link counts once this account declares it on chain and Zolva confirms it.">
            <input id={`zolva-${agentId}`} className={`${inputCls} min-w-[22rem]`} value={draft} onChange={(e) => setDraft(e.target.value.trim().toLowerCase())} placeholder="8a0ab89f-8224-4500-…" />
          </Field>
          <Btn onClick={() => save(draft || null)}>Save</Btn>
          {v?.zolva_agent_id && <Btn onClick={() => save(null)}>Unlink</Btn>}
          {msg && <span className="text-[12.5px] text-muted">{msg}</span>}
        </div>
      )}
    </Panel>
  );
}
