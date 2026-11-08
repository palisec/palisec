"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useState } from "react";
import { shortHex } from "@/lib/units";
import { Btn, Empty, inputCls, Mono, PageTitle, Panel, Pill, Segmented } from "../kit";
import { LoadError, Loading, thCls, utc } from "./common";
import { useLive } from "./session";

interface AuditEvent {
  seq: string;
  event_id: string;
  type: string;
  detail: Record<string, unknown>;
  created_at: string;
  actor_address: string | null;
  actor_agent_id: string | null;
  actor_agent_name: string | null;
}

type Filter = "all" | "operation" | "policy" | "agent" | "credential" | "member" | "org" | "auth";
const tone = (type: string) =>
  type.endsWith(".denied") || type.endsWith(".revoked") || type === "org.emergency_stop.activated" ? "deny" : type.endsWith(".authorized") || type.endsWith(".approved") ? "allow" : type.endsWith(".pending_approval") ? "review" : "muted";

type Range = "24h" | "7d" | "30d" | "all";
const RANGE_MS: Record<Range, number | null> = { "24h": 86400_000, "7d": 7 * 86400_000, "30d": 30 * 86400_000, all: null };

export function LiveAudit() {
  const params = useSearchParams();
  // ?seq=N (from the dashboard) opens that exact record.
  const focusSeq = /^\d{1,18}$/.test(params.get("seq") ?? "") ? params.get("seq")! : null;
  const [filter, setFilter] = useState<Filter>("all");
  const [range, setRange] = useState<Range>("all");
  const [agentId, setAgentId] = useState("");
  const [pages, setPages] = useState<string[]>(focusSeq ? [String(BigInt(focusSeq) + 1n)] : []);
  const [open, setOpen] = useState<string | null>(focusSeq);
  const [since] = useState(() => Date.now());
  const agents = useLive<{ agents: { id: string; name: string }[] }>("/agents");
  const q = new URLSearchParams({ limit: "50" });
  if (filter !== "all") q.set("type", filter);
  if (agentId) q.set("agent_id", agentId);
  const span = RANGE_MS[range];
  if (span) q.set("from", new Date(since - span).toISOString());
  if (pages.length) q.set("before", pages[pages.length - 1]!);
  const list = useLive<{ events: AuditEvent[]; next_before: string | null }>(`/audit-events?${q}`);
  const events = list.data?.events ?? [];

  return (
    <>
      <PageTitle
        title="Audit"
        description="Append-only: the database rejects updates and deletes to this table. Every change and decision is written in the same statement as the change itself. Times in UTC."
        actions={<Btn variant="quiet" onClick={list.reload}>Refresh</Btn>}
      />
      <LoadError error={list.error} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Segmented
          label="Type"
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPages([]);
          }}
          options={(["all", "operation", "policy", "agent", "credential", "member", "org", "auth"] as Filter[]).map((v) => ({ value: v, label: v === "all" ? "All" : v }))}
        />
        <Segmented label="Time range" value={range} onChange={(v) => { setRange(v); setPages([]); }} options={[{ value: "24h", label: "24h" }, { value: "7d", label: "7d" }, { value: "30d", label: "30d" }, { value: "all", label: "All" }]} />
        <select aria-label="Agent" className={`${inputCls} !w-auto`} value={agentId} onChange={(e) => { setAgentId(e.target.value); setPages([]); }}>
          <option value="">All actors</option>
          {(agents.data?.agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <Panel title="Events">
        {!list.data ? (
          <Loading what="events" />
        ) : events.length === 0 ? (
          <Empty title="No events match" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="text-left">
                <tr>{["#", "Time (UTC)", "Event", "Actor", ""].map((h, i) => <th key={i} className={thCls}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <Fragment key={e.seq}>
                    <tr className="border-b border-line hover:bg-raised/40">
                      <td className="px-4 py-2 font-mono text-[11.5px] text-dim">{e.seq}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-[11.5px] text-muted">{utc(e.created_at)}</td>
                      <td className="px-4 py-2"><Pill tone={tone(e.type)}>{e.type}</Pill></td>
                      <td className="px-4 py-2 text-muted">
                        {e.actor_address ? <Mono>{shortHex(e.actor_address)}</Mono> : null}
                        {e.actor_address && e.actor_agent_name ? " · " : null}
                        {e.actor_agent_name ? <span className="text-soft">{e.actor_agent_name}</span> : null}
                        {!e.actor_address && !e.actor_agent_name ? "—" : null}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Btn variant="quiet" aria-expanded={open === e.seq} onClick={() => setOpen(open === e.seq ? null : e.seq)}>{open === e.seq ? "Hide" : "Detail"}</Btn>
                      </td>
                    </tr>
                    {open === e.seq && (
                      <tr className="border-b border-line bg-ink/60">
                        <td colSpan={5} className="px-4 py-3">
                          <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-[11.5px] text-soft">{JSON.stringify({ event_id: e.event_id, ...e.detail }, null, 2)}</pre>
                          {typeof e.detail.operation_id === "string" && (
                            <Link href={`/console/operations?id=${e.detail.operation_id}`} className="mt-2 inline-block font-utility text-[10.5px] uppercase tracking-[0.06em] text-silver hover:text-aqua">Open operation →</Link>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex gap-2 border-t border-line px-4 py-2">
          <Btn variant="quiet" disabled={pages.length === 0} onClick={() => setPages(pages.slice(0, -1))}>Newer</Btn>
          <Btn variant="quiet" disabled={!list.data?.next_before} onClick={() => list.data?.next_before && setPages([...pages, list.data.next_before])}>Older</Btn>
        </div>
      </Panel>
    </>
  );
}
