"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { formatUsd } from "@palisec/policy-schema";
import { LOCAL_ACTOR, registerAgent, setAgentStatus, type SimAgent } from "@/lib/console-sim";
import { commit, useSim } from "@/lib/console-store";
import { formatSimTime, formatUnits, shortHex } from "@/lib/units";
import { CopyButton } from "../copy-button";
import { Codes } from "../ui";
import { AgentStatusPill, Btn, Confirm, Empty, Field, inputCls, KV, Mono, Notice, OpStatusPill, PageTitle, Panel, Pill } from "./kit";

export function AgentsView() {
  const sim = useSim();
  const uid = useId();
  const [selected, setSelected] = useState(sim.agents[0]?.id ?? "");
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{ tone: "deny" | "allow"; text: string } | null>(null);
  const agent = sim.agents.find((a) => a.id === selected) ?? sim.agents[0];

  const act = (fn: Parameters<typeof commit>[0]) => commit(fn);
  const change = (a: SimAgent, status: SimAgent["status"]) =>
    act((s, now) => {
      const r = setAgentStatus(s, a.id, status, now);
      setMessage(r.ok ? { tone: "allow", text: `${a.name} is now ${status}. The local evaluator confirmed the change and the audit trail recorded it.` } : { tone: "deny", text: r.error });
      return r.ok ? r.state : s;
    });

  return (
    <>
      <PageTitle title="Agents" description="Registered agents, the account and policy each is bound to, and the controls that stop them. A paused agent's new operations are denied with RW_PAUSED_001." />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
        <div className="min-w-0 space-y-4">
          <Panel title={`Registered agents · ${sim.agents.length}`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead className="text-left">
                  <tr>{["Agent", "Status", "Owner", "Operations", "Last activity"].map((h) => <th key={h} className="label border-b border-line-strong px-4 py-2 !text-[10px] font-normal">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {sim.agents.map((a) => {
                    const ops = sim.operations.filter((o) => o.agent_id === a.id);
                    const last = ops.at(-1);
                    return (
                      <tr key={a.id} className={`border-b border-line transition-colors ${a.id === agent?.id ? "bg-raised/70" : "hover:bg-raised/40"}`}>
                        <td className="px-4 py-2.5">
                          <button type="button" onClick={() => setSelected(a.id)} aria-pressed={a.id === agent?.id} className="text-left">
                            <span className="block text-bone underline-offset-4 hover:underline">{a.name}</span>
                            <Mono className="text-dim">{a.id}</Mono>
                          </button>
                        </td>
                        <td className="px-4 py-2.5"><StatusPill status={a.status} /></td>
                        <td className="px-4 py-2.5 text-muted">{a.owner}</td>
                        <td className="px-4 py-2.5 font-mono text-soft">{ops.length}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11.5px] text-muted">{last ? formatSimTime(last.created_at).slice(5, 16) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Register an agent">
            <form
              className="flex flex-wrap items-end gap-3 px-4 py-4"
              onSubmit={(e) => {
                e.preventDefault();
                commit((s, now) => {
                  const r = registerAgent(s, name, now);
                  if (!r.ok) {
                    setMessage({ tone: "deny", text: r.error });
                    return s;
                  }
                  const added = r.state.agents.at(-1)!;
                  setSelected(added.id);
                  setName("");
                  setMessage({ tone: "allow", text: `Registered ${added.name}. It inherits the active policy and has no budget share until you assign one.` });
                  return r.state;
                });
              }}
            >
              <div className="min-w-[220px] flex-1">
                <Field id={`${uid}-name`} label="Agent name" hint="POST /v1/agents, simulated. The agent is bound to the example smart account on chain 4663.">
                  <input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={48} placeholder="e.g. Liquidity monitor" className={inputCls} />
                </Field>
              </div>
              <Btn type="submit" variant="primary" disabled={name.trim().length < 3}>Register agent</Btn>
            </form>
          </Panel>
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
        </div>

        {agent ? (
          <Panel title="Agent detail" className="self-start xl:sticky xl:top-16">
            <div key={agent.id} className="animate-[c-fade_.4s_var(--ease-out-quint)] px-4 pt-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[17px] font-semibold text-bone">{agent.name}</p>
                  <Mono className="text-dim">{agent.id}</Mono>
                </div>
                <StatusPill status={agent.status} />
              </div>
              <KV
                className="mt-3"
                rows={[
                  ["Owner", agent.owner],
                  ["Smart account", <span key="a" title={agent.account} className="inline-flex items-center gap-2"><Mono className="whitespace-nowrap">{shortHex(agent.account, 10, 8)}</Mono><CopyButton text={agent.account} label="Copy smart account address" /></span>],
                  ["Chain", <span key="c">Robinhood Chain · <Mono>{agent.chain_id}</Mono> <Pill tone="info" className="ml-1">simulated</Pill></span>],
                  ["Active policy", <Mono key="p">{sim.active_policy.policy_id} · v{sim.active_policy.version}</Mono>],
                  ["Signer identities", <span key="s" className="text-muted">None registered. Protected signing is not deployed, so no signer can be bound to this account.</span>],
                  ["Rate limit", <span key="r"><Mono>{agent.rate_limit_per_min} req / min</Mono> <Pill tone="muted" className="ml-1">○ not enforced by schema 1.0</Pill></span>],
                  ["Budget allocation", <span key="b"><Mono>{agent.budget_share_pct}%</Mono> of {formatUsd(BigInt(sim.active_policy.limits.hourly_budget_usd_micros))} / hour <Pill tone="muted" className="ml-1">○ planned · not enforced</Pill><br /><span className="text-[12px] text-muted">Schema 1.0 enforces the hourly budget per account, shared by every agent on it.</span></span>],
                  ["Per-transaction cap", <Mono key="m">{formatUnits(sim.active_policy.limits.max_transaction_value_wei, 18)} ETH</Mono>],
                  ["API credentials", <span key="k">{sim.credentials.filter((c) => c.status === "active").length} active · <Link href="/console/security" className="underline decoration-line-strong underline-offset-4 hover:text-citrine">manage</Link></span>],
                  ["Registered", formatSimTime(agent.created_at)],
                ]}
              />
            </div>

            <div className="space-y-2 px-4 py-4">
              <p className="label !text-[10px]">Controls · acting as {LOCAL_ACTOR}</p>
              <div className="flex flex-wrap gap-2">
                {agent.status === "active" && (
                  <Confirm label="Pause agent" prompt={<>Pause <strong className="text-bone">{agent.name}</strong>? New operations are denied with <code className="font-mono text-[0.9em]">RW_PAUSED_001</code> until it is resumed. Pending approvals for it can no longer be approved.</>} confirmLabel="Pause agent" onConfirm={() => change(agent, "paused")} />
                )}
                {agent.status === "paused" && (
                  <Confirm variant="primary" label="Resume agent" prompt={<>Resume <strong className="text-bone">{agent.name}</strong>? Checks before resuming: policy v{sim.active_policy.version} is valid, the global stop is {sim.breakers.global_stop ? "ENGAGED (operations will still be denied)" : "released"}.</>} confirmLabel="Resume agent" onConfirm={() => change(agent, "active")} />
                )}
                {agent.status !== "revoked" && (
                  <Confirm label="Revoke agent" prompt={<>Revoke <strong className="text-bone">{agent.name}</strong> permanently? A revoked agent cannot be resumed; register a new one instead.</>} confirmLabel="Revoke permanently" onConfirm={() => change(agent, "revoked")} />
                )}
                {agent.status === "revoked" && <p className="text-[13px] text-muted">Revoked agents keep their history but can never execute again.</p>}
              </div>
            </div>

            <div className="border-t border-line">
              <p className="label px-4 pb-1 pt-3 !text-[10px]">Recent operations</p>
              <RecentOps agentId={agent.id} />
            </div>
          </Panel>
        ) : (
          <Panel title="Agent detail"><Empty title="No agents registered." /></Panel>
        )}
      </div>
    </>
  );
}

function StatusPill({ status }: { status: SimAgent["status"] }) {
  return <AgentStatusPill status={status} />;
}

function RecentOps({ agentId }: { agentId: string }) {
  const sim = useSim();
  const ops = sim.operations.filter((o) => o.agent_id === agentId).slice(-6).reverse();
  if (ops.length === 0) return <Empty title="No operations yet." />;
  return (
    <ul className="divide-y divide-line">
      {ops.map((o) => (
        <li key={o.id}>
          <Link href={`/console/operations#${o.id}`} className="flex items-center justify-between gap-3 px-4 py-2 transition-colors hover:bg-raised/50">
            <span className="min-w-0">
              <span className="block truncate text-[13px] text-soft"><Codes text={o.label} /></span>
              <Mono className="text-dim">{o.id}{o.reason_code ? ` · ${o.reason_code}` : ""}</Mono>
            </span>
            <OpStatusPill status={o.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
