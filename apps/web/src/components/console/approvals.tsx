"use client";

import { useState } from "react";
import { REASON_CODES, formatUsd, selectorOf } from "@palisec/policy-schema";
import { APPROVAL_TTL_SECONDS, agentName, approvalBlocker, approveOperation, rejectOperation, type OpStatus, type SimOperation, type SimState } from "@/lib/console-sim";
import { commit, useSim, useSimNow } from "@/lib/console-store";
import { formatDuration, formatSimTime, formatUnits, shortHex } from "@/lib/units";
import { CopyButton } from "../copy-button";
import { Btn, Confirm, Empty, KV, Mono, Notice, OpStatusPill, PageTitle, Panel, Pill, Segmented } from "./kit";
import { Codes } from "../ui";
import { DecodedArgs, MethodLabel, decodeCall } from "./operations";
import { useHashSelection } from "./use-hash";

type Queue = "pending" | "approved" | "rejected" | "expired" | "failed";
const QUEUE_STATUS: Record<Queue, OpStatus> = { pending: "pending_approval", approved: "approved", rejected: "rejected", expired: "expired", failed: "failed" };
type Sort = "risk" | "age" | "agent";

const isApprovalOp = (o: SimOperation) => o.decision === "REQUIRES_HUMAN_SIGNATURE";

/** An approve() for 2^256 − 1 hands the spender every token the account holds; that dwarfs any native value. */
const unlimitedAllowance = (o: SimOperation) => decodeCall(o.intent.data)?.some((a) => a.name === "amount" && a.value.startsWith("2^256")) ?? false;
const riskOf = (o: SimOperation) => (unlimitedAllowance(o) ? Number.MAX_SAFE_INTEGER : Number(BigInt(o.exposure_usd_micros)));

export function ApprovalsView() {
  const sim = useSim();
  const now = useSimNow();
  const [queue, setQueue] = useState<Queue>("pending");
  const [sort, setSort] = useState<Sort>("risk");
  const [hash, select] = useHashSelection();
  const [notice, setNotice] = useState<{ tone: "allow" | "deny"; text: string } | null>(null);

  const all = sim.operations.filter(isApprovalOp);
  const items = all
    .filter((o) => o.status === QUEUE_STATUS[queue])
    .sort((a, b) =>
      sort === "risk" ? riskOf(b) - riskOf(a) : sort === "age" ? a.created_at - b.created_at : agentName(sim, a.agent_id).localeCompare(agentName(sim, b.agent_id)),
    );
  const selected = all.find((o) => o.id === hash) ?? items[0] ?? null;

  return (
    <>
      <PageTitle title="Human approval queue" description="Operations held by policy for a person to review. The approver sees the exact operation, not a summary, and every decision is bound to its request, reservation and policy version." />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label="Queue state"
          value={queue}
          onChange={setQueue}
          options={(Object.keys(QUEUE_STATUS) as Queue[]).map((q) => ({ value: q, label: q, count: all.filter((o) => o.status === QUEUE_STATUS[q]).length }))}
        />
        <Segmented label="Sort by" value={sort} onChange={setSort} options={[{ value: "risk", label: "Risk" }, { value: "age", label: "Age" }, { value: "agent", label: "Agent" }]} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(300px,420px)_minmax(0,1fr)]">
        <Panel title={`${queue} · ${items.length}`}>
          {items.length === 0 ? (
            <Empty title={queue === "pending" ? "Nothing is waiting for approval." : `No ${queue} approvals.`}>
              {queue === "pending" && "Submit a large swap or an unknown method from Operations to create one."}
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => select(o.id)} aria-pressed={o.id === selected?.id} className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-2 px-4 py-3 text-left transition-colors ${o.id === selected?.id ? "bg-raised/80" : "hover:bg-raised/40"}`}>
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] text-bone"><Codes text={o.label} /></span>
                      <span className="block font-mono text-[11px] text-dim">{o.id} · {agentName(sim, o.agent_id)}</span>
                    </span>
                    <span className="text-right">
                      <span className="block font-mono text-[12px] text-soft">{unlimitedAllowance(o) ? <span className="text-deny">∞ allowance</span> : formatUsd(BigInt(o.exposure_usd_micros))}</span>
                      {o.status === "pending_approval" && o.approval_expires_at ? (
                        <span className={`block font-mono text-[11px] ${o.approval_expires_at - now < 60 ? "c-urgent text-deny" : "text-sand"}`} aria-label={`Expires in ${formatDuration(o.approval_expires_at - now)}`}>{formatDuration(o.approval_expires_at - now)}</span>
                      ) : (
                        <span className="block font-mono text-[11px] text-dim">{formatSimTime(o.created_at).slice(11, 16)}</span>
                      )}
                    </span>
                    {o.status === "pending_approval" && o.approval_expires_at && (
                      <span aria-hidden className="col-span-2 mt-1 block h-px overflow-hidden bg-line">
                        <span
                          className={`c-drain block h-full w-full ${o.approval_expires_at - now < 60 ? "bg-deny" : "bg-sand"}`}
                          style={{ transform: `scaleX(${Math.max(0, (o.approval_expires_at - now) / APPROVAL_TTL_SECONDS)})` }}
                        />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {selected ? (
          <Detail key={selected.id} op={selected} sim={sim} now={now} notice={notice} setNotice={setNotice} onResolved={select} />
        ) : (
          <Panel title="Review"><Empty title="Select an operation to review it." /></Panel>
        )}
      </div>
    </>
  );
}

function Detail({ op, sim, now, notice, setNotice, onResolved }: { op: SimOperation; sim: SimState; now: number; notice: { tone: "allow" | "deny"; text: string } | null; setNotice: (n: { tone: "allow" | "deny"; text: string } | null) => void; onResolved: (id: string) => void }) {
  const blocker = approvalBlocker(sim, op, now);
  const fee = op.fee_estimate_wei ? BigInt(op.fee_estimate_wei) : null;
  const matched = op.checks.find((c) => c.status === "review");
  const reservation = sim.ledger.reservations.find((r) => r.reservation_id === op.reservation_id);
  const record = op.resolved_at
    ? {
        record_type: "approval",
        decision: op.status,
        smart_account: op.intent.from,
        chain_id: op.intent.chain_id,
        target: op.intent.to,
        method_selector: selectorOf(op.intent.data),
        value_wei: op.intent.value_wei,
        operation_hash: op.operation_hash,
        policy_version: op.policy_version,
        request_id: op.id,
        reservation_id: op.reservation_id,
        approver: op.resolved_by,
        resolved_at: op.resolved_at,
        expires_at: op.approval_expires_at,
        one_time_use: true,
        signature: null,
        note: op.resolution_note,
      }
    : null;

  return (
    <div className="min-w-0 animate-[c-fade_.4s_var(--ease-out-quint)] space-y-4">
      <Panel title="Review the exact operation" actions={<OpStatusPill status={op.status} />}>
        <div className="grid gap-x-6 px-4 py-3 lg:grid-cols-2">
          <KV
            rows={[
              ["Request", <Mono key="r">{op.id}</Mono>],
              ["Agent", agentName(sim, op.agent_id)],
              ["Smart account", <span key="a" title={op.intent.from} className="inline-flex items-center gap-2"><Mono className="whitespace-nowrap">{shortHex(op.intent.from, 10, 8)}</Mono><CopyButton text={op.intent.from} label="Copy smart account address" /></span>],
              ["Chain", <Mono key="c">{op.intent.chain_id}</Mono>],
              ["Policy version", <Mono key="p">v{op.policy_version}{op.policy_version !== sim.active_policy.version ? ` (active is v${sim.active_policy.version})` : ""}</Mono>],
              ["Reservation", <Mono key="rs">{op.reservation_id ? `${op.reservation_id.slice(0, 16)}… · ${reservation?.state ?? "—"}` : "—"}</Mono>],
            ]}
          />
          <KV
            rows={[
              ["Target", <span key="t" title={op.intent.to} className="inline-flex items-center gap-2"><Mono className="whitespace-nowrap">{shortHex(op.intent.to, 10, 8)}</Mono><CopyButton text={op.intent.to} label="Copy target address" /></span>],
              ["Method", <MethodLabel key="m" data={op.intent.data} />],
              ["Value", <Mono key="v">{formatUnits(op.intent.value_wei, 18)} ETH</Mono>],
              ["Estimated fee", <Mono key="f">{fee !== null ? `${formatUnits(fee, 18)} ETH` : "unavailable"}</Mono>],
              ["Exposure", unlimitedAllowance(op)
                ? <span key="e"><span className="font-mono text-[12px] text-deny">■ Unlimited token allowance</span><br /><span className="text-[11.5px] text-muted">The spender may move every token this account holds. Native cost: {formatUsd(BigInt(op.exposure_usd_micros))} (value + estimated fee).</span></span>
                : <span key="e"><Mono className="text-bone">{formatUsd(BigInt(op.exposure_usd_micros))}</Mono> <span className="text-[11.5px] text-muted">value + estimated fee</span></span>],
              ["Expiry", op.status === "pending_approval" && op.approval_expires_at ? <Mono key="x" className="text-sand">{formatDuration(op.approval_expires_at - now)} remaining</Mono> : <Mono key="x">{op.approval_expires_at ? formatSimTime(op.approval_expires_at) : "—"}</Mono>],
            ]}
          />
        </div>
        <div className="border-t border-line px-4 py-3">
          <p className="label mb-1.5 !text-[10px]">Matched rule and reason</p>
          <p className="text-[13px] text-soft">
            <Mono className="text-sand">{op.reason_code}</Mono> · {op.reason_code ? REASON_CODES[op.reason_code] : ""}
          </p>
          {matched && <p className="mt-1 text-[12.5px] text-muted">{matched.label}: <Codes text={matched.detail} /></p>}
        </div>
        <div className="border-t border-line px-4 py-3">
          <p className="label mb-1.5 !text-[10px]">Decoded transaction fields</p>
          <DecodedArgs data={op.intent.data} />
        </div>
        <div className="border-t border-line px-4 py-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="label !text-[10px]">Operation hash · raw payload</p>
            <CopyButton text={op.intent.data} label="Copy raw calldata" />
          </div>
          <p className="break-all font-mono text-[11.5px] text-soft">{op.operation_hash} <Pill tone="info" className="ml-1">simulated fingerprint</Pill></p>
          <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-[4px] bg-ink p-2 font-mono text-[11px] text-muted">{op.intent.data}</pre>
        </div>
      </Panel>

      <Panel title="Decision">
        <div className="space-y-3 px-4 py-4">
          {op.status === "pending_approval" ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Btn variant="primary" disabled title="Requires the approval service and an independently authenticated wallet">Approve &amp; Sign</Btn>
                <Confirm
                  variant="ghost"
                  label="Approve in simulation"
                  disabled={blocker !== null}
                  disabledReason={blocker ?? undefined}
                  prompt={<>Approve <Mono>{op.id}</Mono> for {formatUsd(BigInt(op.exposure_usd_micros))}? In simulation this records an unsigned approval bound to this operation hash and policy v{op.policy_version}. It grants no blanket permission.</>}
                  confirmLabel="Record approval"
                  onConfirm={() =>
                    commit((s, t) => {
                      const r = approveOperation(s, op.id, t);
                      if (r.ok) onResolved(op.id);
                      setNotice(r.ok ? { tone: "allow", text: `${op.id} approved (unsigned). The reservation is held; nothing is submitted.` } : { tone: "deny", text: r.error });
                      return r.ok ? r.state : s;
                    })
                  }
                />
                <Confirm
                  label="Reject"
                  prompt={<>Reject <Mono>{op.id}</Mono>? The reservation is released and the agent receives a terminal result.</>}
                  confirmLabel="Reject operation"
                  onConfirm={() =>
                    commit((s, t) => {
                      const r = rejectOperation(s, op.id, t);
                      if (r.ok) onResolved(op.id);
                      setNotice(r.ok ? { tone: "allow", text: `${op.id} rejected. Reservation released.` } : { tone: "deny", text: r.error });
                      return r.ok ? r.state : s;
                    })
                  }
                />
              </div>
              <p className="text-[12.5px] leading-relaxed text-muted">
                <strong className="font-medium text-soft">Approve &amp; Sign</strong> needs an independent wallet signature over this exact UserOperation, which requires the deployed approval
                service. {blocker ? <>Simulated approval is unavailable: <span className="text-deny">{blocker}</span></> : "Approval is disabled automatically if the payload's policy version changes, the window expires, the agent is paused, or the global stop engages."}
              </p>
            </>
          ) : (
            <p className="text-[13px] text-soft">{op.resolution_note}</p>
          )}
          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        </div>
      </Panel>

      {record && (
        <Panel title="Approval record · append-only" className="c-burst" actions={<CopyButton text={JSON.stringify(record, null, 2)} label="Copy approval record" />}>
          <pre className="overflow-auto p-4 font-mono text-[11.5px] leading-relaxed text-soft">{JSON.stringify(record, null, 2)}</pre>
        </Panel>
      )}
    </div>
  );
}
