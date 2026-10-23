"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { REASON_CODES, SCENARIOS, SELECTORS, formatUsd, selectorOf } from "@palisec/policy-schema";
import { agentName, submitOperation, type SimOperation, type SimState } from "@/lib/console-sim";
import { advance, commit, randomHex, useSim, useSimNow } from "@/lib/console-store";
import { formatSimTime, formatUnits, shortHex } from "@/lib/units";
import { Codes, DecisionBadge } from "../ui";
import { ChecksView, JsonView } from "../workbench";
import { Btn, Empty, Field, KV, Mono, Notice, OpStatusPill, PageTitle, Panel, Pill, Segmented, STATUS_LABEL } from "./kit";
import { useHashSelection } from "./use-hash";

const METHOD: Record<string, string> = {
  [SELECTORS.transfer]: "transfer(address,uint256)",
  [SELECTORS.approve]: "approve(address,uint256)",
  [SELECTORS.swapExactTokensForTokens]: "swapExactTokensForTokens(…)",
};
export const methodName = (data: string) => {
  const sel = selectorOf(data);
  return sel ? `${METHOD[sel] ?? "unknown method"} · ${sel}` : "— native transfer";
};

/** Method signature and selector, each kept whole, wrapping only between them. */
export function MethodLabel({ data }: { data: string }) {
  const sel = selectorOf(data);
  if (!sel) return <Mono>— native transfer</Mono>;
  return (
    <Mono>
      <span className="[overflow-wrap:anywhere]">{METHOD[sel] ?? "unknown method"}</span> <span className="whitespace-nowrap text-muted">· {sel}</span>
    </Mono>
  );
}

const ABI: Record<string, { name: string; type: "address" | "uint256" | "address[]" }[]> = {
  [SELECTORS.transfer]: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  [SELECTORS.approve]: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  [SELECTORS.swapExactTokensForTokens]: [
    { name: "amountIn", type: "uint256" },
    { name: "amountOutMin", type: "uint256" },
    { name: "path", type: "address[]" },
    { name: "to", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
};

/** Decode the static arguments of the known illustrative methods. Never guesses an unknown ABI. */
export function decodeCall(data: string): { name: string; type: string; value: string }[] | null {
  const sel = selectorOf(data);
  const abi = sel ? ABI[sel] : undefined;
  if (!abi) return null;
  const words = data.slice(10).match(/.{1,64}/g) ?? [];
  const max = 2n ** 256n - 1n;
  return abi.map((p, i) => {
    const w = words[i];
    if (p.type === "address[]") return { ...p, value: "dynamic array · not decoded in the simulation" };
    if (!w || w.length < 64) return { ...p, value: "not present in the illustrative calldata" };
    if (p.type === "address") return { ...p, value: `0x${w.slice(24)}` };
    const n = BigInt(`0x${w}`);
    return { ...p, value: n === max ? "2^256 − 1 (unlimited)" : n.toString() };
  });
}

export function DecodedArgs({ data }: { data: string }) {
  const args = decodeCall(data);
  if (!args) return <p className="text-[12.5px] text-muted">{selectorOf(data) ? "Unknown method: arguments are not decoded." : "Native transfer: no calldata."}</p>;
  return (
    <table className="w-full text-[12px]">
      <tbody>
        {args.map((a) => (
          <tr key={a.name} className="border-b border-line last:border-b-0">
            <td className="py-1.5 pr-3 font-mono text-soft">{a.name}</td>
            <td className="py-1.5 pr-3 font-mono text-muted">{a.type}</td>
            <td className={`py-1.5 font-mono text-soft ${a.value.startsWith("0x") ? "break-all" : ""}`}>{a.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Filter = "all" | "denied" | "authorized" | "pending";

export function OperationsView() {
  const sim = useSim();
  const now = useSimNow();
  const uid = useId();
  const [agentId, setAgentId] = useState(sim.agents.find((a) => a.status === "active")?.id ?? sim.agents[0]!.id);
  const [scenarioId, setScenarioId] = useState(SCENARIOS[1]!.id);
  const [key, setKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedHash, select] = useHashSelection();
  const [notice, setNotice] = useState<{ tone: "allow" | "deny" | "review"; text: string } | null>(null);

  const selected = sim.operations.find((o) => o.id === selectedHash) ?? sim.operations.at(-1) ?? null;
  const rows = [...sim.operations].reverse().filter((o) =>
    filter === "all" ? true : filter === "denied" ? o.status === "denied" : filter === "pending" ? o.status === "pending_approval" : o.status === "authorized" || o.status === "approved",
  );

  function submit(reuseKey: boolean) {
    const k = reuseKey && key ? key : `idem_${randomHex(8)}`;
    commit((s, t) => {
      const r = submitOperation(s, { agent_id: agentId, scenario_id: scenarioId, idempotency_key: k }, t);
      select(r.op.id);
      setNotice(
        r.replayed
          ? { tone: "review", text: `Idempotency key ${k} was already used: returned ${r.op.id} unchanged. No second evaluation, reservation or signature.` }
          : r.op.decision === "DENY"
            ? { tone: "deny", text: `${r.op.id} denied with ${r.op.reason_code}. Terminal: never signed or broadcast.` }
            : r.op.decision === "ALLOW"
              ? { tone: "allow", text: `${r.op.id} authorized and budget reserved. Signing and submission need the protected path, which is not deployed.` }
              : { tone: "review", text: `${r.op.id} is waiting for a human. Nothing is signed until it is approved.` },
      );
      return r.state;
    });
    if (!reuseKey) setKey(k);
  }

  return (
    <>
      <PageTitle
        title="Operations"
        description="Create protected execution requests and follow each through its separate states. Approval, signing, submission, inclusion and success are never conflated."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(380px,480px)]">
        <div className="min-w-0 space-y-4">
          <Panel title="New protected operation · POST /v1/operations">
            <div className="grid gap-4 px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <fieldset>
                <legend className="label mb-2">Illustrative transaction</legend>
                <div className="space-y-1">
                  {SCENARIOS.map((s) => (
                    <label key={s.id} className={`flex cursor-pointer items-start gap-3 rounded-[6px] border px-3 py-2 transition-colors ${s.id === scenarioId ? "border-citrine/50 bg-raised" : "border-transparent hover:bg-raised/60"}`}>
                      <input type="radio" name={`${uid}-scenario`} checked={s.id === scenarioId} onChange={() => setScenarioId(s.id)} className="mt-1 accent-[#e5ff5d]" />
                      <span className="min-w-0">
                        <span className="block text-[13.5px] text-fg"><Codes text={s.label} /></span>
                        <span className="block text-[12px] text-muted"><Codes text={s.summary} /></span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-4">
                <Field id={`${uid}-agent`} label="Agent">
                  <select id={`${uid}-agent`} value={agentId} onChange={(e) => setAgentId(e.target.value)} className="w-full rounded-[4px] border border-graphite bg-ink px-2.5 py-2 text-[13px] text-fg focus:border-citrine">
                    {sim.agents.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.status}</option>)}
                  </select>
                </Field>
                <Field id={`${uid}-key`} label="Idempotency key" hint="Each submit generates a fresh key. Resubmitting the last key returns the original result instead of creating a second operation.">
                  <input id={`${uid}-key`} value={key ?? "generated on first submit"} readOnly className="w-full rounded-[4px] border border-graphite bg-ink px-2.5 py-1.5 font-mono text-[12px] text-soft" />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Btn variant="primary" onClick={() => submit(false)}>Submit with new key</Btn>
                  <Btn variant="ghost" onClick={() => submit(true)} disabled={!key}>Resubmit same key</Btn>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-2 whitespace-nowrap"><span className="label !text-[10px]">Simulated clock</span><Mono className="text-soft">{formatSimTime(now).slice(11)}</Mono></span>
                  <span className="flex gap-1.5">{[15, 60, 300].map((s) => <Btn key={s} variant="quiet" onClick={() => advance(s)}>+{s}s</Btn>)}</span>
                </div>
                <p className="text-[12px] leading-relaxed text-muted">Advance past a cooldown (15 s intent, 60 s calldata) or a reservation TTL (300 s) to see the decision change.</p>
                {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
              </div>
            </div>
          </Panel>

          <Panel
            title={`Operations · ${sim.operations.length}`}
            actions={
              <Segmented
                label="Filter operations"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All", count: sim.operations.length },
                  { value: "authorized", label: "Authorized", count: sim.operations.filter((o) => o.status === "authorized" || o.status === "approved").length },
                  { value: "pending", label: "Pending", count: sim.operations.filter((o) => o.status === "pending_approval").length },
                  { value: "denied", label: "Denied", count: sim.operations.filter((o) => o.status === "denied").length },
                ]}
              />
            }
          >
            {rows.length === 0 ? (
              <Empty title="No operations match this filter." />
            ) : (
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full text-[13px] md:min-w-[640px]">
                  <thead className="sticky top-0 z-10 bg-surface text-left">
                    <tr>{["Request", "Transaction", "Agent", "Status", "Reason", "Created"].map((h) => <th key={h} className={`label border-b border-line-strong px-3 py-2 !text-[10px] font-normal ${h === "Agent" || h === "Created" ? "hidden md:table-cell" : ""}`}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((o) => (
                      <tr key={o.id} id={o.id} className={`cursor-pointer border-b border-line transition-colors ${o.id === selected?.id ? "is-selected bg-raised/80" : "hover:bg-raised/40"}`} onClick={() => select(o.id)}>
                        <td className="px-3 py-2"><button type="button" onClick={() => select(o.id)} className="font-mono text-[12px] text-bone hover:text-citrine" aria-label={`Inspect ${o.id}`}>{o.id.replace("rw_req_sim_", "#")}</button></td>
                        <td className="px-3 py-2 text-soft"><Codes text={o.label} /></td>
                        <td className="hidden px-3 py-2 text-muted md:table-cell">{agentName(sim, o.agent_id)}</td>
                        <td className="px-3 py-2"><OpStatusPill status={o.status} /></td>
                        <td className="px-3 py-2 font-mono text-[11px] text-stone">{o.reason_code ?? "—"}</td>
                        <td className="hidden whitespace-nowrap px-3 py-2 font-mono text-[11px] text-dim md:table-cell">{formatSimTime(o.created_at).slice(5, 19)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <div className="min-w-0 xl:sticky xl:top-16 xl:self-start">
          {selected ? <Inspector key={selected.id} op={selected} sim={sim} now={now} /> : <Panel title="Operation"><Empty title="Submit an operation to inspect it." /></Panel>}
        </div>
      </div>
    </>
  );
}

type Stage = { name: string; state: "done" | "blocked" | "waiting" | "not-run"; detail: string };

export function lifecycle(op: SimOperation): Stage[] {
  const evaluated: Stage = { name: "Policy evaluation", state: op.decision === "DENY" ? "blocked" : "done", detail: op.decision === "DENY" ? `Denied · ${op.reason_code}` : op.decision === "ALLOW" ? "Allowed by the local evaluator" : `Requires human approval · ${op.reason_code}` };
  const approval: Stage =
    op.decision !== "REQUIRES_HUMAN_SIGNATURE"
      ? { name: "Human approval", state: op.decision === "DENY" ? "not-run" : "done", detail: op.decision === "DENY" ? "Not reached" : "Not required by policy" }
      : op.status === "pending_approval"
        ? { name: "Human approval", state: "waiting", detail: "Waiting in the approval queue" }
        : op.status === "approved"
          ? { name: "Human approval", state: "done", detail: `Approved by ${op.resolved_by} (simulation, unsigned)` }
          : { name: "Human approval", state: "blocked", detail: `${STATUS_LABEL(op.status)} · ${op.resolution_note ?? ""}` };
  const authorized = op.status === "authorized" || op.status === "approved";
  return [
    evaluated,
    { name: "Budget reservation", state: op.reservation_id ? "done" : "not-run", detail: op.reservation_id ? `${op.reservation_id.slice(0, 18)}… · ${formatUsd(BigInt(op.exposure_usd_micros))}` : "No reservation: denied before budget" },
    approval,
    { name: "Signing", state: "not-run", detail: authorized ? "Not run: the protected signing service is not deployed" : "Not reached" },
    { name: "Submission", state: "not-run", detail: authorized ? "Not run: no bundler connection" : "Never broadcast" },
    { name: "Inclusion and receipt", state: "not-run", detail: "transaction_hash is null: nothing was broadcast" },
  ];
}

const STAGE_STYLE = {
  done: { glyph: "✓", cls: "text-citrine" },
  blocked: { glyph: "■", cls: "text-deny" },
  waiting: { glyph: "◆", cls: "text-sand" },
  "not-run": { glyph: "○", cls: "text-dim" },
} as const;

export function Lifecycle({ op }: { op: SimOperation }) {
  return (
    <ol className="space-y-0">
      {lifecycle(op).map((s, i) => (
        <li key={s.name} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 py-1.5">
          <span aria-hidden className={`inline-block animate-[c-pop_.45s_var(--ease-out-quint)_both] font-mono text-[12px] ${STAGE_STYLE[s.state].cls} ${s.state === "waiting" ? "animate-pulse" : ""}`} style={{ animationDelay: `${i * 90 + 100}ms` }}>{STAGE_STYLE[s.state].glyph}</span>
          <span>
            <span className="block text-[13px] text-soft">
              <span className="text-dim">{i + 1}. </span>
              {s.name} <span className="sr-only">({s.state})</span>
            </span>
            <span className="block text-[12px] text-muted"><Codes text={s.detail} /></span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Inspector({ op, sim, now }: { op: SimOperation; sim: SimState; now: number }) {
  const [tab, setTab] = useState<"lifecycle" | "checks" | "response">("lifecycle");
  const response = {
    request_id: op.id,
    decision: op.decision,
    reason_code: op.reason_code,
    policy_id: op.policy_id,
    policy_version: op.policy_version,
    authorization_id: op.authorization_id,
    transaction_hash: null,
    retryable: op.retryable,
    message: op.message,
  };
  return (
    <Panel title="Operation · GET /v1/operations/{id}" actions={<OpStatusPill status={op.status} />} className="animate-[c-fade_.4s_var(--ease-out-quint)]">
      <div className="px-4 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <DecisionBadge decision={op.decision} />
          <Mono className="text-bone">{op.id}</Mono>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-soft"><Codes text={op.message} /></p>
        {op.reason_code && <p className="mt-1 text-[12px] text-muted"><Mono className="text-soft">{op.reason_code}</Mono> · {REASON_CODES[op.reason_code]}{op.retryable ? " · retryable" : " · not retryable"}</p>}
        <KV
          className="mt-3"
          rows={[
            ["Agent", agentName(sim, op.agent_id)],
            ["Target", <Mono key="t">{shortHex(op.intent.to, 10, 6)}</Mono>],
            ["Method", <MethodLabel key="m" data={op.intent.data} />],
            ["Value", <Mono key="v">{formatUnits(op.intent.value_wei, 18)} ETH</Mono>],
            ["Exposure", <Mono key="x">{formatUsd(BigInt(op.exposure_usd_micros))} · value + estimated fee</Mono>],
            ["Policy", <Mono key="p">{op.policy_id ?? "—"} · v{op.policy_version ?? "—"}</Mono>],
            ["Idempotency key", <Mono key="k">{op.idempotency_key}</Mono>],
            ["Operation hash", <span key="h"><Mono>{shortHex(op.operation_hash, 12, 6)}</Mono> <Pill tone="info" className="ml-1">simulated</Pill></span>],
            ["Created", <Mono key="c">{formatSimTime(op.created_at)}</Mono>],
            ...(op.status === "pending_approval" && op.approval_expires_at ? [["Approval expires", <Mono key="e" className="text-sand">in {Math.max(0, op.approval_expires_at - now)}s</Mono>] as [string, React.ReactNode]] : []),
          ]}
        />
      </div>
      <div className="mt-3 border-y border-line px-4 py-2">
        <Segmented label="Operation detail" value={tab} onChange={setTab} options={[{ value: "lifecycle", label: "Lifecycle" }, { value: "checks", label: "Checks" }, { value: "response", label: "Response" }]} />
      </div>
      <div key={tab} className="max-h-[440px] animate-[c-fade_.3s_var(--ease-out-quint)] overflow-auto">
        {tab === "lifecycle" && <div className="px-4 py-3"><Lifecycle op={op} /></div>}
        {tab === "checks" && <ChecksView checks={op.checks} />}
        {tab === "response" && <JsonView json={JSON.stringify(response, null, 2)} label="Copy response JSON" />}
      </div>
      <div className="flex flex-wrap gap-3 border-t border-line px-4 py-3 font-utility text-[10.5px] uppercase tracking-[0.06em]">
        <Link href={`/console/audit#${sim.audit.find((e) => e.request_id === op.id && e.type === "operation.evaluated")?.id ?? ""}`} className="text-stone hover:text-citrine">Audit record →</Link>
        {op.status === "pending_approval" && <Link href={`/console/approvals#${op.id}`} className="text-sand hover:text-citrine">Review approval →</Link>}
      </div>
    </Panel>
  );
}
