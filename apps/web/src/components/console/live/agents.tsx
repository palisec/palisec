"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { shortHex } from "@/lib/units";
import { CopyButton } from "../../copy-button";
import { Btn, Confirm, Empty, Field, inputCls, KV, Mono, Notice, PageTitle, Panel, Pill } from "../kit";
import { ago, LoadError, Loading, thCls, usd, useAction, utc } from "./common";
import { api, can, useConsoleSession, useLive } from "./session";

interface AgentRow {
  id: string;
  name: string;
  chain_id: number;
  account: string;
  status: "active" | "paused" | "revoked";
  policy_id: string | null;
  policy_key: string | null;
  policy_version: number | null;
  policy_disabled: boolean;
  active_keys: number;
  last_operation_at: string | null;
}
interface Credential {
  id: string;
  label: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
}
interface AgentDetail extends AgentRow {
  created_at: string;
  status_changed_at: string | null;
  status_changed_by: string | null;
  credentials: Credential[];
  last_hour: { reserved_usd_micros: string; allowed: number; denied: number; reviewed: number };
}
interface PolicyRow {
  id: string;
  policy_key: string;
  name: string;
  status: string;
  account: { chain_id: number; address: string } | null;
}

const TONE = { active: "allow", paused: "muted", revoked: "deny" } as const;
const GLYPH = { active: "●", paused: "❚❚", revoked: "■" } as const;

function StatusPill({ status }: { status: AgentRow["status"] }) {
  return (
    <Pill tone={TONE[status]}>
      <span aria-hidden>{GLYPH[status]}</span>
      {status}
    </Pill>
  );
}

export function LiveAgents() {
  const { org, refresh } = useConsoleSession();
  const list = useLive<{ agents: AgentRow[] }>("/agents");
  const policies = useLive<{ policies: PolicyRow[] }>("/policies");
  const [selected, setSelected] = useState<string | null>(null);
  const agents = list.data?.agents ?? [];
  const current = selected ?? agents[0]?.id ?? null;

  return (
    <>
      <PageTitle
        title="Agents"
        description="Each agent acts for one smart account, is bound to one policy and authenticates with its own API keys. A paused agent's new operations are denied with RW_PAUSED_001."
      />
      <LoadError error={list.error} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,460px)]">
        <div className="min-w-0 space-y-4">
          <Panel title={`Registered agents · ${agents.length}`}>
            {!list.data ? (
              <Loading what="agents" />
            ) : agents.length === 0 ? (
              <Empty title="No agents yet">Register your first agent with the form below. Create and activate a policy first so you can bind it.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-[13px]">
                  <thead className="text-left">
                    <tr>{["Agent", "Status", "Policy", "Keys", "Last operation"].map((h) => <th key={h} className={thCls}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {agents.map((a) => (
                      <tr key={a.id} className={`border-b border-line transition-colors ${a.id === current ? "bg-raised/70" : "hover:bg-raised/40"}`}>
                        <td className="px-4 py-2.5">
                          <button type="button" onClick={() => setSelected(a.id)} aria-pressed={a.id === current} className="text-left">
                            <span className="block text-bone underline-offset-4 hover:underline">{a.name}</span>
                            <Mono className="text-dim">{shortHex(a.account)}</Mono>
                          </button>
                        </td>
                        <td className="px-4 py-2.5"><StatusPill status={a.status} /></td>
                        <td className="px-4 py-2.5 text-muted">
                          {a.policy_key ? <Mono className="text-soft">{a.policy_key}{a.policy_version ? ` v${a.policy_version}` : " (draft)"}</Mono> : <span className="text-deny">None</span>}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-soft">{a.active_keys}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11.5px] text-muted">{ago(a.last_operation_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          {can.manage(org?.role) && (
            <RegisterAgent
              policies={policies.data?.policies ?? []}
              onCreated={(id) => {
                setSelected(id);
                list.reload();
                refresh();
              }}
            />
          )}
        </div>
        {current && <AgentPanel key={current} id={current} policies={policies.data?.policies ?? []} onChange={list.reload} />}
      </div>
    </>
  );
}

function RegisterAgent({ policies, onCreated }: { policies: PolicyRow[]; onCreated: (id: string) => void }) {
  const uid = useId();
  const [name, setName] = useState("");
  const [account, setAccount] = useState("");
  const [policyId, setPolicyId] = useState("");
  const { run, busy, notice } = useAction();
  const chosen = policies.find((p) => p.id === policyId);

  async function submit() {
    const r = await run(
      () => api<{ id: string }>("/agents", { method: "POST", body: { name, chain_id: 46630, account: chosen?.account?.address ?? account, policy_id: policyId || null } }),
      "Agent registered. Create an API key for it next.",
    );
    if (r) {
      setName("");
      setAccount("");
      onCreated(r.id);
    }
  }

  return (
    <Panel title="Register an agent" bodyClassName="space-y-3 p-4">
      <Field id={`${uid}-name`} label="Name">
        <input id={`${uid}-name`} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Treasury rebalancer" maxLength={80} />
      </Field>
      <Field id={`${uid}-policy`} label="Policy" hint="The agent's account comes from the policy. Without a policy every request is denied with RW_POLICY_001.">
        <select id={`${uid}-policy`} className={inputCls} value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
          <option value="">No policy yet</option>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.policy_key} ({p.status})
            </option>
          ))}
        </select>
      </Field>
      {!chosen && (
        <Field id={`${uid}-account`} label="Smart account address" hint="The account on Robinhood Chain Testnet (46630) that this agent acts for.">
          <input id={`${uid}-account`} className={inputCls} value={account} onChange={(e) => setAccount(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
        </Field>
      )}
      {chosen?.account && (
        <p className="text-[12.5px] text-muted">
          Account <Mono className="text-soft">{chosen.account.address}</Mono> on chain {chosen.account.chain_id}.
        </p>
      )}
      <Btn variant="primary" disabled={busy || !name.trim() || (!chosen && !account)} onClick={submit}>
        Register agent
      </Btn>
      {notice}
    </Panel>
  );
}

function AgentPanel({ id, policies, onChange }: { id: string; policies: PolicyRow[]; onChange: () => void }) {
  const uid = useId();
  const { org } = useConsoleSession();
  const detail = useLive<AgentDetail>(`/agents/${id}`);
  const { run, busy, notice } = useAction();
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const a = detail.data;
  if (detail.error) return <LoadError error={detail.error} />;
  if (!a) return <Panel title="Agent"><Loading what="agent" /></Panel>;

  const after = () => {
    detail.reload();
    onChange();
  };
  const setStatus = (action: "pause" | "resume" | "revoke") =>
    run(() => api(`/agents/${id}/${action}`, { method: "POST", body: { confirm: true } }), `${a.name}: ${action} confirmed by the server.`).then(after);
  const bindable = policies.filter((p) => !p.account || (p.account.chain_id === a.chain_id && p.account.address.toLowerCase() === a.account.toLowerCase()));

  return (
    <div className="space-y-4">
      <Panel title={a.name} actions={<StatusPill status={a.status} />} bodyClassName="p-4">
        <KV
          rows={[
            ["Agent ID", <Mono key="id" className="text-soft">{a.id}</Mono>],
            ["Account", <Mono key="acct" className="text-soft">{a.account}</Mono>],
            ["Chain", `Robinhood Chain Testnet · ${a.chain_id}`],
            ["Policy", a.policy_key ? <Link key="p" href="/console/policies" className="hover:text-citrine"><Mono>{a.policy_key}{a.policy_version ? ` v${a.policy_version}` : " (no active version)"}{a.policy_disabled ? " · disabled" : ""}</Mono></Link> : "None: every request is denied"],
            ["Last hour", `${a.last_hour.allowed} allowed · ${a.last_hour.denied} denied · ${a.last_hour.reviewed} review · ${usd(a.last_hour.reserved_usd_micros)} reserved`],
            ["Status changed", a.status_changed_at ? `${utc(a.status_changed_at)}${a.status_changed_by ? ` by ${shortHex(a.status_changed_by)}` : ""}` : "—"],
          ]}
        />
        {a.status !== "revoked" && (
          <div className="mt-4 flex flex-wrap gap-2">
            {a.status === "active" && can.operate(org?.role) && (
              <Confirm label="Pause agent" prompt="New operations from this agent will be denied with RW_PAUSED_001 as soon as the server confirms. Existing authorizations are not recalled." confirmLabel="Pause" onConfirm={() => setStatus("pause")} disabled={busy} />
            )}
            {a.status === "paused" && can.manage(org?.role) && (
              <Confirm variant="primary" label="Resume agent" prompt="The agent can be authorized again under its policy." confirmLabel="Resume" onConfirm={() => setStatus("resume")} disabled={busy} />
            )}
            {can.manage(org?.role) && (
              <Confirm label="Revoke agent" prompt="Permanent. The agent and all its API keys stop working. This cannot be undone." confirmLabel="Revoke permanently" onConfirm={() => setStatus("revoke")} disabled={busy} />
            )}
          </div>
        )}
        {notice && <div className="mt-3">{notice}</div>}
      </Panel>

      {a.status !== "revoked" && can.manage(org?.role) && (
        <Panel title="Policy binding" bodyClassName="p-4">
          <Field id={`${uid}-bind`} label="Bound policy" hint="Only policies for this agent's account and chain are listed.">
            <select
              id={`${uid}-bind`}
              className={inputCls}
              value={a.policy_id ?? ""}
              disabled={busy}
              onChange={(e) => run(() => api(`/agents/${id}`, { method: "PATCH", body: { policy_id: e.target.value || null } }), "Policy binding updated.").then(after)}
            >
              <option value="">No policy</option>
              {bindable.map((p) => (
                <option key={p.id} value={p.id}>{p.name} · {p.policy_key} ({p.status})</option>
              ))}
            </select>
          </Field>
        </Panel>
      )}

      <Panel title={`API keys · ${a.credentials.filter((c) => !c.revoked_at).length} active`} bodyClassName="p-4 space-y-3">
        {secret && (
          <div className="rounded-[6px] border border-citrine/40 bg-citrine/[0.04] p-3">
            <p className="text-[12.5px] text-soft">Copy this key now and store it in your agent&apos;s secret store. It is never shown again.</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-bone">{secret}</code>
              <CopyButton text={secret} />
            </div>
            <Btn variant="quiet" className="mt-2" onClick={() => setSecret(null)}>I have stored it</Btn>
          </div>
        )}
        {a.credentials.length === 0 ? (
          <p className="text-[13px] text-muted">No keys yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {a.credentials.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12.5px]">
                <div className="min-w-0">
                  <p className="text-soft">{c.label} <Mono className="text-dim">{c.prefix}…</Mono></p>
                  <p className="text-[11.5px] text-muted">Created {utc(c.created_at)} · last used {ago(c.last_used_at)}</p>
                </div>
                {c.revoked_at ? (
                  <Pill tone="deny">Revoked</Pill>
                ) : (
                  can.manage(org?.role) && (
                    <Confirm label="Revoke" variant="quiet" prompt="Requests with this key fail immediately with RW_AUTH_001." confirmLabel="Revoke key" onConfirm={() => run(() => api(`/credentials/${c.id}/revoke`, { method: "POST" }), "Key revoked.").then(after)} />
                  )
                )}
              </li>
            ))}
          </ul>
        )}
        {a.status !== "revoked" && can.manage(org?.role) && (
          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <div className="min-w-[12rem] flex-1">
              <Field id={`${uid}-label`} label="New key label">
                <input id={`${uid}-label`} className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="production worker" maxLength={80} />
              </Field>
            </div>
            <Btn
              variant="primary"
              disabled={busy}
              onClick={async () => {
                const r = await run(() => api<{ secret: string }>(`/agents/${id}/credentials`, { method: "POST", body: { label: label.trim() || "API key" } }));
                if (r) {
                  setSecret(r.secret);
                  setLabel("");
                  after();
                }
              }}
            >
              Create key
            </Btn>
          </div>
        )}
        {a.status === "paused" && <Notice>This agent is paused: its keys authenticate, but every new operation is denied.</Notice>}
      </Panel>
    </div>
  );
}
