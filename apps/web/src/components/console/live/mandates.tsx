"use client";

import { useState } from "react";
import { Btn, Field, inputCls, Mono, PageTitle, Panel } from "../kit";
import { LoadError, Loading, useAction } from "./common";
import { api, can, useConsoleSession, useLive } from "./session";

/**
 * Holder mandates for owners. Create a mandate for an agent, set its envelope (tightening now,
 * loosening after the delay), follow proposals and cancel a passed loosening that is waiting (with a
 * reason that is shown publicly). Votes themselves are signed by holders, not here.
 */
interface MandateRow { id: string; slug: string; name: string; demo: boolean; agent_name: string; account: string }
interface Agent { id: string; name: string; chain_id: number; account: string; status: string; policy_id: string | null }
interface MandateDetail {
  id: string;
  slug: string;
  name: string;
  demo: boolean;
  envelope: Record<string, unknown>;
  active: { version: number; since: string; hourly_budget_usd_micros: string; max_transaction_value_wei: string; approval_threshold_usd_micros: string } | null;
  proposals: { id: string; number: number; title: string; state: string; closes_at: string; applied: string | null; pending: { state: string; effective_at: string; resolution: string | null } | null; tally: { for: string; against: string; cast: string; quorum_reached: boolean } }[];
}

const DEFAULT_ENVELOPE = JSON.stringify(
  { max_transaction_value_wei: "300000000000000", max_hourly_budget_usd_micros: "2000000", min_approval_threshold_usd_micros: "500000", allowed_contracts: [] },
  null,
  2,
);

export function LiveMandates() {
  const { org } = useConsoleSession();
  const list = useLive<{ mandates: MandateRow[] }>("/mandates");
  const agents = useLive<Agent[] | { agents: Agent[] }>("/agents");
  const [open, setOpen] = useState<string | null>(null);
  const { run, busy, notice } = useAction();
  const [form, setForm] = useState({ agent_id: "", slug: "", name: "", voting_period_seconds: "86400", quorum: "1000", pass_bps: "5000", proposer_min: "1", envelope: DEFAULT_ENVELOPE, demo: false });
  const agentList = (Array.isArray(agents.data) ? agents.data : (agents.data?.agents ?? [])).filter((a) => a.chain_id === 4663 && a.status !== "revoked" && a.policy_id);

  return (
    <div className="space-y-4">
      <PageTitle title="Mandates" description="Token holders vote on an agent's limits within the hard limits (envelope) you set here; Palisec enforces the result. Loosening votes and envelope loosening wait out the loosening delay; the emergency stop always wins." />
      <Panel title={`Mandates · ${list.data?.mandates.length ?? 0}`} bodyClassName="p-4 space-y-2">
        {list.error && <LoadError error={list.error} />}
        {list.loading && <Loading what="mandates" />}
        {list.data?.mandates.length === 0 && <p className="text-[13.5px] text-muted">No mandates yet.</p>}
        {list.data?.mandates.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 first:border-t-0 first:pt-0">
            <span className="text-mist">{m.name} <Mono className="text-muted">/m/{m.slug}</Mono>{m.demo ? <span className="ml-2 text-[12px] text-review">demo</span> : null}</span>
            <span className="flex gap-2">
              <a className="font-utility text-[12.5px] text-silver hover:text-aqua" href={`/m/${m.slug}`} target="_blank" rel="noreferrer">Public page ↗</a>
              <Btn onClick={() => setOpen(open === m.id ? null : m.id)}>{open === m.id ? "Close" : "Manage"}</Btn>
            </span>
          </div>
        ))}
      </Panel>
      {open && <MandateManage id={open} canOwn={org?.role === "owner"} canOperate={can.operate(org?.role)} />}
      {can.manage(org?.role) && (
        <Panel title="Create a mandate (Robinhood Chain mainnet, $PALISEC votes)" bodyClassName="p-4 space-y-3">
          <Field id="m-agent" label="Agent" hint="The agent whose policy the votes will set. Its current policy must already be inside the envelope.">
            <select id="m-agent" className={inputCls} value={form.agent_id} onChange={(e) => setForm({ ...form, agent_id: e.target.value })}>
              <option value="">Choose an agent</option>
              {agentList.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.account.slice(0, 8)}…</option>)}
            </select>
          </Field>
          {(["name", "slug", "voting_period_seconds", "quorum", "pass_bps", "proposer_min"] as const).map((k) => (
            <Field key={k} id={`m-${k}`} label={{ name: "Name", slug: "Public page address (/m/…)", voting_period_seconds: "Voting period (seconds)", quorum: "Quorum ($PALISEC)", pass_bps: "Passes above (basis points; 5000 = 50%)", proposer_min: "Proposer minimum ($PALISEC)" }[k]}>
              <input id={`m-${k}`} className={inputCls} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </Field>
          ))}
          <Field id="m-env" label="Envelope (hard limits holders can never vote past)" hint="Per-transaction value in wei, hourly budget and approval floor in USD micros, and the only contracts and functions a vote may allow.">
            <textarea id="m-env" rows={9} className={`${inputCls} font-mono text-[12.5px]`} value={form.envelope} onChange={(e) => setForm({ ...form, envelope: e.target.value })} />
          </Field>
          <Btn
            variant="primary"
            disabled={busy || !form.agent_id}
            onClick={() =>
              run(async () => {
                const envelope = JSON.parse(form.envelope);
                return api("/mandates", { method: "POST", body: { ...form, voting_period_seconds: Number(form.voting_period_seconds), pass_bps: Number(form.pass_bps), envelope } });
              }, "Mandate created.").then(() => list.reload())
            }
          >
            Create mandate
          </Btn>
          {notice}
        </Panel>
      )}
    </div>
  );
}

function MandateManage({ id, canOwn, canOperate }: { id: string; canOwn: boolean; canOperate: boolean }) {
  const d = useLive<MandateDetail>(`/mandates/${id}`);
  const { run, busy, notice } = useAction();
  const [env, setEnv] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (d.error) return <LoadError error={d.error} />;
  if (!d.data) return <Panel title="Mandate"><Loading what="mandate" /></Panel>;
  const m = d.data;
  return (
    <Panel title={`${m.name} · envelope and proposals`} bodyClassName="p-4 space-y-4">
      <div>
        <p className="mb-1 font-utility text-[12.5px] text-muted">Envelope</p>
        <textarea rows={9} className={`${inputCls} font-mono text-[12.5px]`} readOnly={!canOwn} value={env ?? JSON.stringify(m.envelope, null, 2)} onChange={(e) => setEnv(e.target.value)} />
        {canOwn && (
          <Btn className="mt-2" disabled={busy || env === null} onClick={() => run(() => api(`/mandates/${id}/envelope`, { method: "POST", body: { envelope: JSON.parse(env ?? "{}") } }), "Envelope saved: tightening applies now; loosening waits out the delay (see the banner).").then(() => { setEnv(null); d.reload(); })}>
            Save envelope
          </Btn>
        )}
      </div>
      <div className="space-y-2">
        <p className="font-utility text-[12.5px] text-muted">Proposals</p>
        {m.proposals.length === 0 && <p className="text-[13.5px] text-muted">None yet. Holders open proposals with a signed request.</p>}
        {m.proposals.map((p) => (
          <div key={p.id} className="rounded-[6px] border border-line p-3 text-[13.5px]">
            <p className="text-mist">#{p.number} · {p.title} · <span className="text-muted">{p.state}{p.applied ? ` · ${p.pending?.state ?? p.applied}` : ""}</span></p>
            {p.pending?.state === "pending" && canOperate && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Field id={`r-${p.id}`} label="Cancel this pending loosening: reason (shown publicly)">
                  <input id={`r-${p.id}`} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <Btn disabled={busy || reason.trim().length < 3} onClick={() => run(() => api(`/mandates/${id}/proposals/${p.id}/cancel`, { method: "POST", body: { reason } }), "Cancelled; the reason is on the public page.").then(() => d.reload())}>
                  Cancel
                </Btn>
              </div>
            )}
          </div>
        ))}
      </div>
      {notice}
    </Panel>
  );
}
