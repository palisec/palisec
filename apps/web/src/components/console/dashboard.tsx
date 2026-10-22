"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUsd, type Decision } from "@palisec/policy-schema";
import { agentName, type SimState } from "@/lib/console-sim";
import { useSim, useSimNow } from "@/lib/console-store";
import { formatDuration, formatSimTime } from "@/lib/units";
import { Empty, KV, Mono, PageTitle, Panel, Pill, Segmented } from "./kit";

const HOUR = 3600;

export function DashboardView() {
  const sim = useSim();
  const now = useSimNow();
  const ops = sim.operations;
  const dayOps = ops.filter((o) => o.created_at > now - 24 * HOUR);
  const count = (d: Decision) => dayOps.filter((o) => o.decision === d).length;
  const pending = ops.filter((o) => o.status === "pending_approval");

  const reserved = sim.ledger.reservations
    .filter((r) => r.created_at > now - HOUR && (r.state === "pending_approval" || (r.state === "reserved" && r.expires_at > now)))
    .reduce((a, r) => a + BigInt(r.amount_usd_micros), 0n);
  const finalized = sim.ledger.reservations.filter((r) => r.state === "finalized").reduce((a, r) => a + BigInt(r.amount_usd_micros), 0n);
  const budget = BigInt(sim.active_policy.limits.hourly_budget_usd_micros);
  const pct = budget > 0n ? Number((reserved * 1000n) / budget) / 10 : 0;
  const activeVersion = sim.versions.find((v) => v.version === sim.active_policy.version);

  return (
    <>
      <PageTitle title="Dashboard" description="Agents, policy state, decisions and budget for this workspace. Every number below is computed from operations the local evaluator actually decided." />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="min-w-0 space-y-4">
          <Panel title="Execution outcomes · last 24 hours" actions={<span className="font-mono text-[10.5px] text-dim">UTC · 1 h buckets · by decision at evaluation</span>}>
            <dl className="grid grid-cols-3 border-b border-line">
              {([
                ["Allowed", count("ALLOW"), "text-citrine"],
                ["Denied", count("DENY"), "text-deny"],
                ["Held for review", count("REQUIRES_HUMAN_SIGNATURE"), "text-sand"],
              ] as const).map(([k, v, cls], i) => (
                <div key={k} className={`px-4 py-3 ${i > 0 ? "border-l border-line" : ""}`}>
                  <dt className="label !text-[10px]">{k}</dt>
                  <dd className={`mt-1 font-mono text-[22px] leading-none ${cls}`}>{v}</dd>
                </div>
              ))}
            </dl>
            <OutcomesChart sim={sim} now={now} />
          </Panel>

          <Panel title="Recent security events" actions={<Link href="/console/audit" className="font-utility text-[10.5px] uppercase tracking-[0.06em] text-stone hover:text-citrine">Full audit →</Link>}>
            <SecurityEvents sim={sim} />
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel title="Agents" actions={<Link href="/console/agents" className="font-utility text-[10.5px] uppercase tracking-[0.06em] text-stone hover:text-citrine">Manage →</Link>}>
            <ul className="divide-y divide-line">
              {sim.agents.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] text-bone">{a.name}</span>
                    <Mono className="text-dim">{a.id}</Mono>
                  </span>
                  <Pill tone={a.status === "active" ? "allow" : a.status === "paused" ? "review" : "deny"}>
                    <span aria-hidden>{a.status === "active" ? "●" : a.status === "paused" ? "❚❚" : "■"}</span>
                    {a.status}
                  </Pill>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Policy">
            <div className="px-4 py-1">
              <KV
                rows={[
                  ["Active", <Mono key="p">{sim.active_policy.policy_id} · v{sim.active_policy.version}</Mono>],
                  ["Activated", activeVersion ? <span key="a">{formatSimTime(activeVersion.activated_at)}<br /><span className="text-muted">by {activeVersion.activated_by}</span></span> : "—"],
                  ["Draft", sim.draft ? <Link key="d" href="/console/policies" className="text-sand underline decoration-sand/50 underline-offset-4">Unactivated draft from v{sim.draft.based_on}</Link> : "None"],
                  ["Failure mode", <Mono key="f">{sim.active_policy.failure_mode}</Mono>],
                ]}
              />
            </div>
          </Panel>

          <Panel title="Budget · rolling hour">
            <div className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[20px] text-bone">{formatUsd(reserved)}</span>
                <span className="font-mono text-[11px] text-muted">of {formatUsd(budget)} reserved</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, pct)} aria-label="Hourly budget reserved">
                <div className={`h-full rounded-full ${pct >= 100 ? "bg-deny" : "bg-citrine"}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
                Spent (finalized): <Mono className="text-soft">{formatUsd(finalized)}</Mono>. Nothing finalizes in simulation because nothing is submitted;
                reservations release when they expire.
              </p>
            </div>
          </Panel>

          <Panel title="Pending approvals" actions={<Link href="/console/approvals" className="font-utility text-[10.5px] uppercase tracking-[0.06em] text-stone hover:text-citrine">Queue →</Link>}>
            {pending.length === 0 ? (
              <Empty title="No operations are waiting for a human." />
            ) : (
              <ul className="divide-y divide-line">
                {pending.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] text-bone">{o.label}</span>
                      <Mono className="text-dim">{o.id}</Mono>
                    </span>
                    <Mono className="text-sand">{formatDuration((o.approval_expires_at ?? now) - now)}</Mono>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Connectivity">
            <ul className="divide-y divide-line text-[13px]">
              {[
                ["Policy engine", "Local reference evaluator", true],
                ["Signing service", "Not deployed: no enclave, no signer", false],
                ["Chain / bundler", "Not connected: nothing is submitted", false],
                ["Telemetry", "Off: events stay in this browser", false],
              ].map(([k, v, ok]) => (
                <li key={k as string} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <span className="text-muted">{k}</span>
                  <span className={`text-right ${ok ? "text-citrine" : "text-stone"}`}>
                    <span aria-hidden>{ok ? "● " : "○ "}</span>
                    {v}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

type Bucket = { start: number; allow: number; deny: number; review: number };

function OutcomesChart({ sim, now }: { sim: SimState; now: number }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [hover, setHover] = useState<number | null>(null);
  const buckets = useMemo<Bucket[]>(() => {
    const end = Math.floor(now / HOUR) * HOUR + HOUR;
    const list = Array.from({ length: 24 }, (_, i) => ({ start: end - (24 - i) * HOUR, allow: 0, deny: 0, review: 0 }));
    for (const o of sim.operations) {
      const b = list.find((x) => o.created_at >= x.start && o.created_at < x.start + HOUR);
      if (!b) continue;
      if (o.decision === "ALLOW") b.allow++;
      else if (o.decision === "DENY") b.deny++;
      else b.review++;
    }
    return list;
  }, [sim.operations, now]);
  const total = buckets.reduce((a, b) => a + b.allow + b.deny + b.review, 0);
  const max = Math.max(2, ...buckets.map((b) => b.allow + b.deny + b.review));
  const hh = (t: number) => new Date(t * 1000).toISOString().slice(11, 16);

  const W = 720, H = 180, PL = 28, PB = 22, PT = 10;
  const bw = (W - PL) / 24;
  const y = (v: number) => PT + (H - PT - PB) * (1 - v / max);

  return (
    <div className="px-4 pb-4 pt-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul aria-label="Legend" className="flex flex-wrap gap-4 font-utility text-[10.5px] uppercase tracking-[0.05em] text-soft">
          <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-[2px] bg-citrine" />Allow</li>
          <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-[2px] bg-deny" />Deny</li>
          <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-[2px] bg-[repeating-linear-gradient(45deg,#bdb8a0_0_2px,transparent_2px_4px)] ring-1 ring-sand/60" />Review</li>
        </ul>
        <Segmented label="Chart or table" value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />
      </div>

      {total === 0 ? (
        <Empty title="No operations in the last 24 hours.">Submit one from Operations; it appears here in its hour.</Empty>
      ) : view === "table" ? (
        <div className="max-h-[260px] overflow-auto">
          <table className="w-full font-mono text-[11.5px]">
            <thead className="sticky top-0 bg-surface text-left text-muted">
              <tr>{["Hour (UTC)", "Allow", "Deny", "Review"].map((h) => <th key={h} className="border-b border-line-strong px-2 py-1.5 font-normal">{h}</th>)}</tr>
            </thead>
            <tbody>
              {buckets.filter((b) => b.allow + b.deny + b.review > 0).map((b) => (
                <tr key={b.start} className="border-b border-line text-soft">
                  <td className="px-2 py-1.5">{hh(b.start)}–{hh(b.start + HOUR)}</td>
                  <td className="px-2 py-1.5">{b.allow}</td>
                  <td className="px-2 py-1.5">{b.deny}</td>
                  <td className="px-2 py-1.5">{b.review}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Hourly outcomes for the last 24 hours: ${total} operations. Use the table view for exact values.`} onMouseLeave={() => setHover(null)}>
            <defs>
              <pattern id="rw-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="4" height="4" fill="#14150f" />
                <rect width="2" height="4" fill="#bdb8a0" />
              </pattern>
            </defs>
            {[0, max / 2, max].map((v) => (
              <g key={v}>
                <line x1={PL} x2={W} y1={y(v)} y2={y(v)} stroke="#22241b" />
                <text x={PL - 6} y={y(v) + 3} textAnchor="end" className="fill-[#5a5d4e] font-mono text-[9px]">{Math.round(v)}</text>
              </g>
            ))}
            {buckets.map((b, i) => {
              const x = PL + i * bw + 2;
              const w = bw - 4;
              const segs = [
                { v: b.allow, fill: "#e5ff5d" },
                { v: b.deny, fill: "#ff5247" },
                { v: b.review, fill: "url(#rw-hatch)" },
              ].filter((s) => s.v > 0);
              let acc = 0;
              return (
                <g key={b.start} onMouseEnter={() => setHover(i)}>
                  <rect x={PL + i * bw} y={PT} width={bw} height={H - PT - PB} fill="transparent" />
                  {segs.map((s, k) => {
                    const top = y(acc + s.v);
                    const h = y(acc) - top - (k > 0 ? 2 : 0);
                    acc += s.v;
                    return <rect key={k} x={x} y={top} width={w} height={Math.max(1, h)} rx={k === segs.length - 1 ? 3 : 0} fill={s.fill} opacity={hover === null || hover === i ? 1 : 0.45} />;
                  })}
                  {i % 4 === 0 && <text x={PL + i * bw + bw / 2} y={H - 6} textAnchor="middle" className="fill-[#5a5d4e] font-mono text-[9px]">{hh(b.start)}</text>}
                </g>
              );
            })}
          </svg>
          {hover !== null && (() => {
            const b = buckets[hover]!;
            return (
              <div className="pointer-events-none absolute top-0 rounded-[6px] border border-line-strong bg-carbon/95 px-2.5 py-1.5 font-mono text-[11px] text-soft shadow-[0_10px_24px_-10px_rgb(0_0_0/0.9)]" style={{ left: `clamp(0px, calc(${((PL + hover * bw) / W) * 100}% - 40px), calc(100% - 150px))` }}>
                <p className="text-bone">{hh(b.start)}–{hh(b.start + HOUR)} UTC</p>
                <p>Allow {b.allow} · Deny {b.deny} · Review {b.review}</p>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function SecurityEvents({ sim }: { sim: SimState }) {
  const events = sim.audit.filter((e) => e.type !== "operation.evaluated" || e.decision === "DENY").slice(-8).reverse();
  if (events.length === 0) return <Empty title="No security events yet." />;
  return (
    <ul className="divide-y divide-line">
      {events.map((e) => (
        <li key={e.id}>
          <Link href={`/console/audit#${e.id}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-raised/50">
            <Pill tone={e.decision === "DENY" || e.type.startsWith("breaker.engaged") || e.type === "agent.revoked" ? "deny" : e.type.startsWith("approval") || e.type === "agent.paused" ? "review" : "muted"}>{e.type}</Pill>
            <span className="min-w-0 truncate text-[13px] text-soft">
              {e.summary}
              {e.agent_id && <span className="text-dim"> · {agentName(sim, e.agent_id)}</span>}
            </span>
            <Mono className="text-dim">{formatSimTime(e.at).slice(11, 19)}</Mono>
          </Link>
        </li>
      ))}
    </ul>
  );
}
