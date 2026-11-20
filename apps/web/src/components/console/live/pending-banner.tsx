"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./session";

/**
 * Phase 6: every change that weakens the rules waits out a delay. This banner shows each one with a
 * countdown, what it changes, and a Cancel button (owner, admin or operator; the server checks).
 */
interface Change {
  path: string;
  kind: "tightening" | "loosening";
  note: string;
}
interface Pending {
  id: string;
  kind: string;
  policy_key: string | null;
  policy_version: number | null;
  agent_name: string | null;
  summary: string;
  diff: Change[];
  requested_by: string | null;
  effective_at: string;
}

const LABEL: Record<string, string> = {
  policy_activation: "Policy loosening",
  agent_rebind: "Agent moving to a looser policy",
  agent_resume: "Agent resume",
  emergency_lift: "Emergency stop lift",
  delay_change: "Shorter delay",
  agent_upoch: "Agent's Upoch workflow change",
  mandate_envelope: "Mandate envelope loosening",
};

function left(ms: number) {
  if (ms <= 0) return "applying now";
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}h ` : ""}${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export function PendingBanner() {
  const [items, setItems] = useState<Pending[]>([]);
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ pending: Pending[]; server_time: string }>("/pending-changes")
      .then((r) => {
        setItems(r.pending);
        setSkew(new Date(r.server_time).getTime() - Date.now());
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 30_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  useEffect(() => {
    if (items.some((p) => new Date(p.effective_at).getTime() - (now + skew) < -1500)) load();
  }, [items, now, skew, load]);

  async function cancel(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/pending-changes/${id}/cancel`, { method: "POST", body: {} });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel");
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) return null;
  return (
    <section role="alert" aria-label="Pending loosening" className="mb-6 rounded-[6px] border border-review/50 bg-review/[0.06] px-4 py-3">
      <p className="font-utility text-[12px] text-review">● Rules will loosen after a delay. The current rules keep deciding until then. Cancel anything you did not expect.</p>
      <ul className="mt-2 space-y-3">
        {items.map((p) => (
          <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-line pt-2 first:border-t-0 first:pt-0">
            <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
              <p className="text-mist">
                {LABEL[p.kind] ?? "Loosening"}
                {p.policy_key ? ` · ${p.policy_key} v${p.policy_version}` : ""}
                {p.agent_name ? ` · ${p.agent_name}` : ""}
                <span className="ml-2 font-mono text-review" aria-live="off">
                  {left(new Date(p.effective_at).getTime() - (now + skew))}
                </span>
              </p>
              <ul className="mt-1 space-y-0.5 text-[12.5px] text-muted">
                {p.diff.slice(0, 6).map((d, i) => (
                  <li key={i}>
                    <span className={d.kind === "loosening" ? "text-review" : "text-allow"}>{d.kind === "loosening" ? "▲ looser" : "▼ stricter"}</span> {d.note}
                  </li>
                ))}
                {p.diff.length > 6 && <li>and {p.diff.length - 6} more</li>}
              </ul>
              <p className="mt-1 font-utility text-[11.5px] text-dim">Applies {new Date(p.effective_at).toISOString().replace("T", " ").slice(0, 19)} UTC</p>
            </div>
            <button type="button" className="btn btn-ghost shrink-0" disabled={busy === p.id} onClick={() => cancel(p.id)}>
              {busy === p.id ? "Cancelling…" : "Cancel"}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-[12.5px] text-deny">{error}</p>}
    </section>
  );
}
