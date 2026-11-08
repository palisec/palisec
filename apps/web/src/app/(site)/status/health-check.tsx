"use client";

import { useState } from "react";

interface Health {
  status: string;
  components: Record<string, string>;
  schema_migration: string | null;
}

/** Runs the deep health check only when asked, so viewing the page never wakes the database. */
export function HealthCheck() {
  const [h, setH] = useState<Health | null>(null);
  const [state, setState] = useState<"idle" | "checking" | "error">("idle");
  const [at, setAt] = useState<string | null>(null);

  async function check() {
    setState("checking");
    try {
      const res = await fetch("/api/v1/health", { cache: "no-store" });
      setH((await res.json()) as Health);
      setAt(new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC");
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="mb-6 space-y-4">
      <button type="button" onClick={check} disabled={state === "checking"} className="border border-line-strong px-4 py-2 text-sm text-fg hover:border-aqua/60 disabled:opacity-50">
        {state === "checking" ? "Checking…" : "Check now"}
      </button>
      {state === "error" && <p className="font-mono text-[11px] tracking-[0.08em] text-deny">■ THE API DID NOT RESPOND</p>}
      {h && (
        <div>
          <ul className="divide-y divide-line border-y border-line">
            {Object.entries(h.components).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between py-3 text-sm">
                <span className="text-soft">{k.replace(/_/g, " ")}</span>
                <span className={`font-mono text-[11px] uppercase tracking-[0.08em] ${v === "ok" ? "text-allow" : v === "not_deployed" ? "text-dim" : "text-deny"}`}>
                  {v === "ok" ? "● ok" : v === "not_deployed" ? "○ not deployed" : `■ ${v}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 font-mono text-[11px] text-dim">Checked {at} · schema {h.schema_migration ?? "unknown"}</p>
        </div>
      )}
    </div>
  );
}
