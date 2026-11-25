"use client";

import Link from "next/link";
import { useState } from "react";
import { Btn, Empty, Mono, PageTitle, Panel, Pill, RefreshBtn, Segmented } from "../kit";
import { ago, LoadError, Loading, useAction } from "./common";
import { api, can, useConsoleSession, useLive } from "./session";

interface Finding {
  id: string;
  category: string;
  severity: "info" | "warning" | "critical";
  title: string;
  evidence: Record<string, unknown>;
  source: string;
  status: string;
  occurrences: number;
  created_at: string;
  updated_at: string;
  decided_by: string | null;
}

/** Record references in a finding's evidence, as console links. */
function EvidenceLinks({ e }: { e: Record<string, unknown> }) {
  const ops = Array.isArray(e.operation_ids) ? (e.operation_ids as string[]) : [];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
      {typeof e.agent_id === "string" && (
        <Link href={`/console/agents?id=${e.agent_id}`} className="rounded-[4px] bg-aqua/[0.08] px-1.5 font-mono text-aqua hover:underline">agent·{e.agent_id.slice(0, 8)}</Link>
      )}
      {typeof e.policy_id === "string" && (
        <Link href={`/console/policies?id=${e.policy_id}`} className="rounded-[4px] bg-aqua/[0.08] px-1.5 font-mono text-aqua hover:underline">policy·{e.policy_id.slice(0, 8)}</Link>
      )}
      {ops.slice(0, 6).map((id) => (
        <Link key={id} href={`/console/operations?op=${id}`} className="rounded-[4px] bg-aqua/[0.08] px-1.5 font-mono text-aqua hover:underline">op·{id.slice(0, 8)}</Link>
      ))}
      {ops.length > 6 && <span className="text-dim">+{ops.length - 6}</span>}
      {typeof e.count_24h === "number" && <span className="text-muted">{e.count_24h} in 24h</span>}
      {typeof e.target === "string" && <Mono className="text-dim">{e.target}</Mono>}
    </div>
  );
}

export function LiveSecurityEvents() {
  const { org } = useConsoleSession();
  const [status, setStatus] = useState<"open" | "acknowledged" | "resolved">("open");
  const list = useLive<{ findings: Finding[] }>(`/security-events?status=${status}`);
  const { run, notice } = useAction();
  const set = (id: string, s: string) => run(() => api(`/security-events/${id}`, { method: "PATCH", body: { status: s } })).then(list.reload);

  return (
    <>
      <PageTitle
        title="Security events"
        description="Findings from deterministic detectors over your real records: repeated denials, replayed requests, unapproved contracts and methods, budget thresholds, unfamiliar targets, rejections, pauses and emergency stops. Each cites the records behind it. Enforcement stays with the policy engine."
        actions={<RefreshBtn label="Run detection now" onClick={() => api(`/security-events?status=${status}&refresh=1`).then(list.reload)} />}
      />
      <div className="mb-4">
        <Segmented label="Status" value={status} options={[{ value: "open", label: "Open" }, { value: "acknowledged", label: "Acknowledged" }, { value: "resolved", label: "Resolved" }]} onChange={(v) => setStatus(v as typeof status)} />
      </div>
      <LoadError error={list.error} />
      {notice}
      <Panel bodyClassName="p-0">
        {!list.data ? (
          <Loading what="findings" />
        ) : list.data.findings.length === 0 ? (
          <Empty title={`No ${status} findings`}>Detection runs when you open this page, when the Palisec Agent investigates, and after denied operations.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {list.data.findings.map((f) => (
              <li key={f.id} id={f.id} className="space-y-1.5 px-4 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex min-w-0 items-center gap-2">
                    <Pill tone={f.severity === "critical" ? "deny" : f.severity === "warning" ? "review" : "muted"}>{f.severity}</Pill>
                    <span className="text-[13.5px] text-mist">{f.title}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-utility text-[12px] text-dim">
                      {f.category.replaceAll("_", " ")} · {f.source}{f.occurrences > 1 ? ` · ${f.occurrences}×` : ""} · {ago(f.updated_at)}
                    </span>
                    {can.operate(org?.role) && f.status === "open" && <Btn variant="quiet" onClick={() => set(f.id, "acknowledged")}>Acknowledge</Btn>}
                    {can.operate(org?.role) && f.status !== "resolved" && <Btn variant="quiet" onClick={() => set(f.id, "resolved")}>Resolve</Btn>}
                    {can.operate(org?.role) && f.status === "resolved" && <Btn variant="quiet" onClick={() => set(f.id, "open")}>Reopen</Btn>}
                  </span>
                </div>
                <EvidenceLinks e={f.evidence} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
