"use client";

import { useId, useMemo, useState } from "react";
import { REASON_CODES, selectorOf, type Decision } from "@palisec/policy-schema";
import { agentName, type AuditEvent, type SimState } from "@/lib/console-sim";
import { useSim, useSimNow } from "@/lib/console-store";
import { formatSimTime } from "@/lib/units";
import { ChecksView } from "../workbench";
import { Btn, Empty, EventPill, Field, inputCls, KV, Mono, OpStatusPill, PageTitle, Panel, STATUS_LABEL } from "./kit";
import { Codes } from "../ui";
import { DecodedArgs, Lifecycle, MethodLabel } from "./operations";
import { useHashSelection } from "./use-hash";

const RANGES = [
  { value: "3600", label: "Last hour" },
  { value: "86400", label: "Last 24 hours" },
  { value: "all", label: "All time" },
];

interface Filters {
  range: string;
  agent: string;
  decision: string;
  reason: string;
  version: string;
  status: string;
  contract: string;
  selector: string;
  txHash: string;
  requestId: string;
}
const NONE: Filters = { range: "all", agent: "", decision: "", reason: "", version: "", status: "", contract: "", selector: "", txHash: "", requestId: "" };

const selectCls = "w-full rounded-[4px] border border-graphite bg-ink px-2 py-1.5 text-[12.5px] text-fg focus:border-citrine";

export function AuditView() {
  const sim = useSim();
  const now = useSimNow();
  const uid = useId();
  const [f, setF] = useState<Filters>(NONE);
  const [hash, select] = useHashSelection();
  const set = (k: keyof Filters, v: string) => setF((x) => ({ ...x, [k]: v }));

  const opById = useMemo(() => new Map(sim.operations.map((o) => [o.id, o])), [sim.operations]);
  const rows = useMemo(() => {
    return [...sim.audit].reverse().filter((e) => {
      const op = e.request_id ? opById.get(e.request_id) : undefined;
      if (f.range !== "all" && e.at < now - Number(f.range)) return false;
      if (f.agent && e.agent_id !== f.agent) return false;
      if (f.decision && e.decision !== f.decision) return false;
      if (f.reason && e.reason_code !== f.reason) return false;
      if (f.version && String(e.policy_version ?? "") !== f.version) return false;
      if (f.status && op?.status !== f.status) return false;
      if (f.contract && !op?.intent.to.toLowerCase().includes(f.contract.toLowerCase())) return false;
      if (f.selector && selectorOf(op?.intent.data ?? "") !== f.selector.toLowerCase()) return false;
      if (f.txHash) return false; // Nothing is broadcast, so no record has a transaction hash.
      if (f.requestId && !(e.request_id ?? "").includes(f.requestId.trim())) return false;
      return true;
    });
  }, [sim.audit, f, now, opById]);

  const selected = sim.audit.find((e) => e.id === hash) ?? rows[0] ?? null;
  const active = Object.entries(f).filter(([k, v]) => v && !(k === "range" && v === "all")).length;

  function exportJson() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2) + "\n"], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `palisec-audit-simulation.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageTitle
        title="Audit and forensics"
        description="Every decision and administrative action, append-only. Records can be filtered and exported, never edited or deleted."
        actions={<Btn variant="quiet" onClick={exportJson} disabled={rows.length === 0}>Export {rows.length} records</Btn>}
      />

      <Panel title={`Filters${active ? ` · ${active} active` : ""}`} actions={active ? <Btn variant="quiet" onClick={() => setF(NONE)}>Clear filters</Btn> : undefined} className="mb-4">
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field id={`${uid}-range`} label="Time range">
            <select id={`${uid}-range`} value={f.range} onChange={(e) => set("range", e.target.value)} className={selectCls}>{RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
          </Field>
          <Field id={`${uid}-agent`} label="Agent and account">
            <select id={`${uid}-agent`} value={f.agent} onChange={(e) => set("agent", e.target.value)} className={selectCls}>
              <option value="">Any agent</option>
              {sim.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field id={`${uid}-decision`} label="Decision">
            <select id={`${uid}-decision`} value={f.decision} onChange={(e) => set("decision", e.target.value)} className={selectCls}>
              <option value="">Any decision</option>
              {(["ALLOW", "DENY", "REQUIRES_HUMAN_SIGNATURE"] as Decision[]).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field id={`${uid}-reason`} label="Reason code">
            <select id={`${uid}-reason`} value={f.reason} onChange={(e) => set("reason", e.target.value)} className={selectCls}>
              <option value="">Any code</option>
              {Object.keys(REASON_CODES).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field id={`${uid}-version`} label="Policy version">
            <select id={`${uid}-version`} value={f.version} onChange={(e) => set("version", e.target.value)} className={selectCls}>
              <option value="">Any version</option>
              {sim.versions.map((v) => <option key={v.version} value={v.version}>v{v.version}</option>)}
            </select>
          </Field>
          <Field id={`${uid}-status`} label="Operation status">
            <select id={`${uid}-status`} value={f.status} onChange={(e) => set("status", e.target.value)} className={selectCls}>
              <option value="">Any status</option>
              {(["denied", "authorized", "pending_approval", "approved", "rejected", "expired", "failed"] as const).map((s) => <option key={s} value={s}>{STATUS_LABEL(s)}</option>)}
            </select>
          </Field>
          <Field id={`${uid}-contract`} label="Contract">
            <input id={`${uid}-contract`} value={f.contract} onChange={(e) => set("contract", e.target.value)} placeholder="0x3333…" spellCheck={false} className={inputCls} />
          </Field>
          <Field id={`${uid}-selector`} label="Method selector">
            <input id={`${uid}-selector`} value={f.selector} onChange={(e) => set("selector", e.target.value)} placeholder="0x38ed1739" spellCheck={false} className={inputCls} />
          </Field>
          <Field id={`${uid}-tx`} label="Transaction hash" hint="Always empty here: nothing is broadcast.">
            <input id={`${uid}-tx`} value={f.txHash} onChange={(e) => set("txHash", e.target.value)} placeholder="0x…" spellCheck={false} className={inputCls} />
          </Field>
          <Field id={`${uid}-req`} label="Request ID">
            <input id={`${uid}-req`} value={f.requestId} onChange={(e) => set("requestId", e.target.value)} placeholder="rw_req_sim_0004" spellCheck={false} className={inputCls} />
          </Field>
          <Field id={`${uid}-pcr`} label="Enclave measurement" hint="No enclave is deployed, so no record carries one.">
            <select id={`${uid}-pcr`} disabled className={`${selectCls} opacity-50`}><option>None available</option></select>
          </Field>
        </div>
      </Panel>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
        <Panel title={`Records · ${rows.length}`}>
          {rows.length === 0 ? (
            <Empty title="No records match these filters.">{f.txHash ? "No record has a transaction hash because the simulation never broadcasts." : "Clear a filter to widen the search."}</Empty>
          ) : (
            <div className="max-h-[640px] overflow-auto">
              <table className="w-full min-w-[620px] text-[12.5px]">
                <thead className="sticky top-0 z-10 bg-surface text-left">
                  <tr>{["Event", "Time (UTC)", "Type", "Summary", "Actor"].map((h) => <th key={h} className="label border-b border-line-strong px-3 py-2 !text-[10px] font-normal">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} className={`cursor-pointer border-b border-line align-top transition-colors ${e.id === selected?.id ? "is-selected bg-raised/80" : "hover:bg-raised/40"}`} onClick={() => select(e.id)}>
                      <td className="px-3 py-2"><button type="button" onClick={() => select(e.id)} className="font-mono text-[11.5px] text-bone hover:text-citrine" aria-label={`Open ${e.id}`}>{e.id}</button></td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-dim">{formatSimTime(e.at).slice(5, 19)}</td>
                      <td className="px-3 py-2"><TypePill e={e} /></td>
                      <td className="px-3 py-2 text-soft"><Codes text={e.summary} /></td>
                      <td className="px-3 py-2 text-muted">{e.actor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="min-w-0 xl:sticky xl:top-16 xl:self-start">
          {selected ? <Detail key={selected.id} e={selected} sim={sim} /> : <Panel title="Record detail"><Empty title="Select a record to open it." >Records linked from the dashboard open here directly.</Empty></Panel>}
        </div>
      </div>
    </>
  );
}

function TypePill({ e }: { e: AuditEvent }) {
  return <EventPill type={e.type} decision={e.decision} />;
}

function Detail({ e, sim }: { e: AuditEvent; sim: SimState }) {
  const op = e.request_id ? sim.operations.find((o) => o.id === e.request_id) : undefined;
  const reservation = op?.reservation_id ? sim.ledger.reservations.find((r) => r.reservation_id === op.reservation_id) : undefined;
  const related = op ? sim.audit.filter((x) => x.request_id === op.id) : [];
  return (
    <Panel title={`Record · ${e.id}`} actions={<TypePill e={e} />} className="animate-[c-fade_.4s_var(--ease-out-quint)]">
      <div className="px-4 py-3">
        <KV
          rows={[
            ["Time", <Mono key="t">{formatSimTime(e.at)}</Mono>],
            ["Actor", e.actor],
            ["Summary", <Codes key="s" text={e.summary} />],
            ...(e.agent_id ? [["Agent", `${agentName(sim, e.agent_id)} · ${e.agent_id}`] as [string, string]] : []),
            ...(e.policy_version != null ? [["Policy version", <Mono key="v">v{e.policy_version}</Mono>] as [string, React.ReactNode]] : []),
            ...(e.reason_code ? [["Reason", <span key="r"><Mono>{e.reason_code}</Mono> · {REASON_CODES[e.reason_code]}</span>] as [string, React.ReactNode]] : []),
            ["Integrity", <span key="i" className="text-muted">Sequence #{e.seq} of {sim.audit.length}. Append-only: the console offers no edit or delete.</span>],
          ]}
        />
      </div>
      {op && (
        <>
          <div className="border-t border-line px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="label !text-[10px]">Operation {op.id}</p>
              <OpStatusPill status={op.status} />
            </div>
            <KV
              rows={[
                ["Target", <Mono key="t">{op.intent.to}</Mono>],
                ["Method", <MethodLabel key="m" data={op.intent.data} />],
                ["Decoded", <DecodedArgs key="d" data={op.intent.data} />],
                ["Authorization", <Mono key="a">{op.authorization_id ?? "none issued"}</Mono>],
                ["Transaction hash", <Mono key="h">null · never broadcast</Mono>],
                ["Enclave measurement", <span key="e" className="text-muted">none · no enclave deployed</span>],
              ]}
            />
          </div>
          <div className="border-t border-line px-4 py-3">
            <p className="label mb-1 !text-[10px]">Signing, submission and receipt reconciliation</p>
            <Lifecycle op={op} />
          </div>
          <div className="border-t border-line px-4 py-3">
            <p className="label mb-1.5 !text-[10px]">Budget reservation lifecycle</p>
            {reservation ? (
              <ol className="space-y-1 font-mono text-[11.5px] text-soft">
                <li>created · {formatSimTime(reservation.created_at).slice(11, 19)} · {reservation.amount_usd_micros} µUSD · v{reservation.policy_version}</li>
                {related.filter((x) => x.type.startsWith("approval")).map((x) => <li key={x.id}>{x.type.replace("approval.", "")} · {formatSimTime(x.at).slice(11, 19)}</li>)}
                <li className={reservation.state === "released" ? "text-dim" : "text-citrine"}>current state · {reservation.state}{reservation.state === "reserved" ? ` · expires ${formatSimTime(reservation.expires_at).slice(11, 19)}` : ""}</li>
              </ol>
            ) : (
              <p className="text-[12.5px] text-muted">No reservation: the request was denied before budget was reserved.</p>
            )}
          </div>
          <div className="border-t border-line">
            <p className="label px-4 pt-3 !text-[10px]">Policy evaluation sequence</p>
            <ChecksView checks={op.checks} />
          </div>
        </>
      )}
    </Panel>
  );
}
