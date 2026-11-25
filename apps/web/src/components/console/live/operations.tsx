"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { explorerTx } from "@/lib/networks";
import { formatUnits, shortHex } from "@/lib/units";
import { Codes } from "../../ui";
import { Btn, Confirm, Empty, inputCls, KV, Mono, PageTitle, Panel, Segmented, RefreshBtn } from "../kit";
import { CheckList, DecisionPill, displayState, LoadError, Loading, StatePill, thCls, usd, useAction, utc, type LiveOperation } from "./common";
import { api, can, useConsoleSession, useLive } from "./session";

type Filter = "all" | "ALLOW" | "DENY" | "REQUIRES_HUMAN_SIGNATURE";

export function LiveOperations() {
  const params = useSearchParams();
  const reason = params.get("reason_code");
  const focusId = params.get("id");
  const initial = params.get("decision");
  const [filter, setFilter] = useState<Filter>(initial === "ALLOW" || initial === "DENY" || initial === "REQUIRES_HUMAN_SIGNATURE" ? initial : "all");
  const [agentId, setAgentId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [pages, setPages] = useState<string[]>([]);
  const query = new URLSearchParams({ limit: "50" });
  if (filter !== "all") query.set("decision", filter);
  if (reason && /^PS_[A-Z]+_\d{3}$/.test(reason)) query.set("reason_code", reason);
  if (agentId) query.set("agent_id", agentId);
  if (/^[A-Za-z0-9_.:-]{1,128}$/.test(requestId.trim())) query.set("request_id", requestId.trim());
  if (pages.length) query.set("before", pages[pages.length - 1]!);
  const list = useLive<{ operations: LiveOperation[]; next_before: string | null }>(`/operations?${query}`);
  const agents = useLive<{ agents: { id: string; name: string }[] }>("/agents");
  // A link to one operation (from the dashboard or audit) opens it even if it is not on this page.
  const focused = useLive<LiveOperation>(focusId && /^[0-9a-f-]{36}$/i.test(focusId) ? `/operations/${focusId}` : null);
  const [selected, setSelected] = useState<string | null>(null);
  const ops = list.data?.operations ?? [];
  const current = ops.find((o) => o.operation_id === selected) ?? (!selected ? focused.data : null) ?? ops[0] ?? null;

  return (
    <>
      <PageTitle
        title="Operations"
        description={`Every request your agents sent, with the decision, reason code and the full evaluation sequence. Newest first, times in UTC.${reason ? ` Filtered to ${reason}.` : ""}`}
        actions={<RefreshBtn onClick={list.reload} label="Refresh list" />}
      />
      <LoadError error={list.error} />
      <LoadError error={focused.error} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Segmented
          label="Decision"
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPages([]);
          }}
          options={[
            { value: "all", label: "All" },
            { value: "ALLOW", label: "Allowed" },
            { value: "DENY", label: "Denied" },
            { value: "REQUIRES_HUMAN_SIGNATURE", label: "Review" },
          ]}
        />
        <select aria-label="Agent" className={`${inputCls} !w-auto`} value={agentId} onChange={(e) => { setAgentId(e.target.value); setPages([]); }}>
          <option value="">All agents</option>
          {(agents.data?.agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input aria-label="Request ID" className={`${inputCls} !w-56`} placeholder="Request ID" value={requestId} onChange={(e) => { setRequestId(e.target.value); setPages([]); }} spellCheck={false} />
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,460px)]">
        <Panel title="Operations">
          {!list.data ? (
            <Loading what="operations" />
          ) : ops.length === 0 ? (
            <Empty title="No operations match">Operations appear when an agent calls POST /v1/operations with its API key.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead className="text-left">
                  <tr>{["Time (UTC)", "Agent", "Decision", "State", "Reason"].map((h) => <th key={h} className={thCls}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {ops.map((o) => (
                    <tr key={o.operation_id} className={`cursor-pointer border-b border-line transition-colors ${o.operation_id === current?.operation_id ? "bg-raised/70" : "hover:bg-raised/40"}`} onClick={() => setSelected(o.operation_id)}>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-[11.5px] text-muted">
                        <button type="button" className="text-left" aria-pressed={o.operation_id === current?.operation_id} onClick={() => setSelected(o.operation_id)}>{utc(o.created_at).slice(5, 19)}</button>
                      </td>
                      <td className="px-4 py-2 text-soft">{o.details.agent_name}</td>
                      <td className="px-4 py-2"><DecisionPill decision={o.decision} /></td>
                      <td className="px-4 py-2"><StatePill state={displayState(o)} /></td>
                      <td className="px-4 py-2 font-mono text-[11.5px] text-muted">{o.reason_code ?? "—"}</td>
                    </tr>
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
        {current && <OperationDetail op={current} onChange={list.reload} />}
      </div>
    </>
  );
}

/** On-chain execution through the Palisec smart account: co-signature, bundler hash and the transaction. */
function ExecutionRows({ op }: { op: LiveOperation }) {
  const x = op.details.execution!;
  const tx = op.transaction_hash ?? null;
  const link = tx ? explorerTx(op.details.chain_id, tx) : null;
  const result = x.executed_at ? (x.success ? "succeeded on chain" : "reverted on chain") : x.user_op_hash ? "submitted, waiting for the receipt" : "submission not confirmed";
  return (
    <div>
      <p className="label mb-1">Execution</p>
      <KV
        rows={[
          ["Co-signed by Palisec", x.user_op_hash ? `yes · ${utc(x.submitted_at)}` : "claimed, bundler did not confirm"],
          ["Result", result],
          ["User operation", x.user_op_hash ? <Mono key="u" className="break-all text-[11px]">{x.user_op_hash}</Mono> : "—"],
          ["Transaction", tx ? (
            <span key="tx" className="flex flex-col items-end gap-0.5">
              <Mono className="break-all text-[11px]">{tx}</Mono>
              {link && <a href={link} target="_blank" rel="noopener noreferrer" className="text-[12px] text-aqua underline-offset-4 hover:underline">View on the explorer</a>}
            </span>
          ) : "—"],
          ["Executed", utc(x.executed_at)],
        ]}
      />
    </div>
  );
}

function OperationDetail({ op, onChange }: { op: LiveOperation; onChange: () => void }) {
  const { org } = useConsoleSession();
  const { run, busy, notice } = useAction();
  const d = op.details;
  const releasable = ["authorized", "approved", "pending_approval"].includes(op.state) && !op.details.execution;
  return (
    <Panel title="Operation" actions={<StatePill state={displayState(op)} />} bodyClassName="p-4 space-y-4">
      <p className="text-[13px] leading-relaxed text-soft"><Codes text={op.message} /></p>
      <KV
        rows={[
          ["Operation ID", <Mono key="id">{op.operation_id}</Mono>],
          ["Request ID", <Mono key="r">{op.request_id}</Mono>],
          ["Agent", d.agent_name],
          ["Policy", op.policy_id ? <Mono key="p">{op.policy_id} v{op.policy_version}</Mono> : "None"],
          ["Account", <Mono key="a">{shortHex(d.account)}</Mono>],
          ["Target", <Mono key="t">{d.target}</Mono>],
          ["Method", <Mono key="m">{d.selector ?? "native transfer"}</Mono>],
          ["Value", `${formatUnits(d.value_wei, 18)} ETH`],
          ["Fee bound", d.fee_estimate_wei ? `${formatUnits(d.fee_estimate_wei, 18)} ETH (gas limit ${d.gas_limit})` : "unavailable"],
          ["Exposure reserved", usd(d.exposure_usd_micros)],
          ["Authorization", op.authorization_id ? <Mono key="au">{op.authorization_id}</Mono> : "—"],
          ["Expires", utc(op.expires_at)],
          ["Decided by", d.decided_by ? <Mono key="db">{shortHex(d.decided_by)} · {utc(d.decided_at)}</Mono> : "—"],
          ["Request hash", <Mono key="h" className="break-all text-[11px]">{d.request_hash}</Mono>],
        ]}
      />
      {d.execution && <ExecutionRows op={op} />}
      <div>
        <p className="label mb-1">Evaluation sequence</p>
        <CheckList checks={op.checks} />
      </div>
      {releasable && can.operate(org?.role) && (
        <Confirm
          label={op.state === "pending_approval" ? "Withdraw request" : "Release unused authorization"}
          prompt="Only release an authorization you know was not sent. Its budget returns to the hourly window, and the release is recorded with your identity."
          confirmLabel="Release"
          disabled={busy}
          onConfirm={() => run(() => api(`/operations/${op.operation_id}/cancel`, { method: "POST" }), "Released.").then(onChange)}
        />
      )}
      {notice}
    </Panel>
  );
}
