"use client";

import { useCallback, useEffect, useState } from "react";
import { Confirm, KV, Meter, Notice, Panel } from "../kit";
import { usd, utc } from "./common";
import { api } from "./session";

/**
 * Loss limits: the agent's loss limit. Current loss against the limit, paused or not, and the owner's reset
 * with its countdown. Values come from Palisec's own measurements (before every decision and hourly);
 * nothing here reads the chain.
 */
interface LossStatus {
  enabled: boolean;
  limits?: { max_drawdown_bps: number; max_loss_usd_micros: string; window_seconds: number; on_breach: "pause_risk" | "review" };
  value_usd_micros?: string | null;
  peak_usd_micros?: string | null;
  loss_usd_micros?: string | null;
  drawdown_bps?: number | null;
  measured_at?: string | null;
  paused?: "PS_LOSS_001" | "PS_LOSS_002" | null;
  paused_at?: string | null;
  window_started_at?: string | null;
  value_unavailable?: boolean;
  value_unavailable_reason?: string | null;
  reset_pending?: { pending_change_id: string; effective_at: string } | null;
}

const pct = (bps: number) => `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, "0")}%`;
const hours = (s: number) => (s % 86400 === 0 ? `${s / 86400} d` : `${Math.round(s / 3600)} h`);
const left = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

export function LossLimitPanel({ agentId, canReset }: { agentId: string; canReset: boolean }) {
  const [s, setS] = useState<LossStatus | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(() => {
    api<LossStatus>(`/agents/${agentId}/loss-limit`).then(setS).catch(() => setS(null));
  }, [agentId]);
  useEffect(load, [load]);
  const pendingAt = s?.reset_pending ? new Date(s.reset_pending.effective_at).getTime() : null;
  useEffect(() => {
    if (!pendingAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pendingAt]);

  if (!s?.enabled || !s.limits) return null;
  const l = s.limits;
  const usdLimit = BigInt(l.max_loss_usd_micros);
  const loss = s.loss_usd_micros ? BigInt(s.loss_usd_micros) : null;
  const dd = s.drawdown_bps ?? null;
  // How close to the nearer limit, 0..1.
  const fractions = [
    usdLimit > 0n && loss !== null ? Number((loss * 10000n) / usdLimit) / 10000 : 0,
    l.max_drawdown_bps > 0 && dd !== null ? dd / l.max_drawdown_bps : 0,
  ];
  const fraction = Math.max(...fractions);
  const limitText = [usdLimit > 0n ? usd(l.max_loss_usd_micros) : null, l.max_drawdown_bps > 0 ? pct(l.max_drawdown_bps) : null].filter(Boolean).join(" or ");
  const code = s.paused;

  return (
    <Panel title="Loss limit" bodyClassName="p-4 space-y-3">
      {code ? (
        <Notice tone="deny">
          {`Paused for risk (${code}) since ${s.paused_at ? utc(s.paused_at) : "the last check"}. ${l.on_breach === "review" ? "Every trade that adds risk waits for a human." : "Trades that add risk are denied."} Swaps into the policy's stablecoins and transfers to the exit addresses are still allowed. Only the owner can reset.`}
        </Notice>
      ) : s.value_unavailable ? (
        <Notice tone="review">The account&apos;s value could not be measured reliably at the last check (a price is stale, paused or depegged). Trades that add risk fail closed with PS_LOSS_003 until it can.{s.value_unavailable_reason ? ` Reason: ${s.value_unavailable_reason}` : ""}</Notice>
      ) : null}
      <Meter fraction={fraction} label="Loss against the limit" danger={fraction >= 0.8 || !!code} />
      <KV
        rows={[
          ["Loss in the window", loss !== null ? `${usd(s.loss_usd_micros)} · ${pct(dd ?? 0)} of the peak` : "Not measured yet"],
          ["Limit", `${limitText} over ${hours(l.window_seconds)} (${l.on_breach === "review" ? "hold for a human" : "deny"} when reached)`],
          ["Account value", s.value_usd_micros ? usd(s.value_usd_micros) : "Not measured yet"],
          ["Peak in the window", s.peak_usd_micros ? `${usd(s.peak_usd_micros)} (deposits and withdrawals taken out)` : "—"],
          ["Measured (UTC)", s.measured_at ? utc(s.measured_at) : "—"],
          ["Window counted from (UTC)", s.window_started_at ? utc(s.window_started_at) : "—"],
        ]}
      />
      {s.reset_pending && pendingAt && (
        <Notice tone="review">{`Reset pending: applies at ${utc(s.reset_pending.effective_at)} (in ${left(pendingAt - now)}). Cancel it under Pending changes.`}</Notice>
      )}
      {canReset && code && !s.reset_pending && (
        <Confirm
          variant="primary"
          label="Reset loss limit"
          prompt="Creates a new policy version that clears the pause. It is a loosening: it waits for your organization's delay, everyone is alerted, and it can be cancelled until then. When it applies, the window starts again from the account's value at that moment."
          confirmLabel="Request reset"
          onConfirm={() =>
            api<{ effective_at: string | null }>(`/agents/${agentId}/loss-limit/reset`, { method: "POST", body: { confirm: true } })
              .then((r) => {
                setMsg(r.effective_at ? `Reset requested; applies at ${utc(r.effective_at)}.` : "Reset applied.");
                load();
              })
              .catch((e) => setMsg(e instanceof Error ? e.message : "Could not request the reset"))
          }
        />
      )}
      {msg && <p className="text-[12.5px] text-muted">{msg}</p>}
      <p className="text-[12px] text-dim">Prices from Chainlink on Robinhood Chain. Tokens without a Chainlink price count as $0.</p>
    </Panel>
  );
}
