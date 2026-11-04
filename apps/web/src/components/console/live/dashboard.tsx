"use client";

import Link from "next/link";
import { Codes } from "../../ui";
import { Empty, Mono, PageTitle, Panel, Pill } from "../kit";
import { LoadError, Loading, thCls, usd } from "./common";
import { useLive } from "./session";

interface Summary {
  allowed: number;
  denied: number;
  reviewed: number;
  pending_approvals: number;
  reserved_last_hour_usd_micros: string;
  hourly: { hour: string; allowed: number; denied: number; reviewed: number }[];
  deny_reasons: { reason_code: string; count: number }[];
}
interface AgentRow {
  id: string;
  name: string;
  status: string;
  policy_key: string | null;
  policy_version: number | null;
  active_keys: number;
  last_operation_at: string | null;
}
interface PolicyRow {
  id: string;
  status: string;
}
interface Org {
  name: string;
  emergency_stop: boolean;
}

export function LiveDashboard() {
  const summary = useLive<Summary>("/summary");
  const agents = useLive<{ agents: AgentRow[] }>("/agents");
  const policies = useLive<{ policies: PolicyRow[] }>("/policies");
  const org = useLive<Org>("/organization");
  const s = summary.data;
  const a = agents.data?.agents ?? [];
  const p = policies.data?.policies ?? [];
  const total = s ? s.allowed + s.denied + s.reviewed : 0;

  const steps = [
    { done: p.length > 0, text: "Create a policy for your agent's smart account", href: "/console/policies" },
    { done: p.some((x) => x.status === "active"), text: "Validate and activate it", href: "/console/policies" },
    { done: a.length > 0, text: "Register the agent and bind it to the policy", href: "/console/agents" },
    { done: a.some((x) => x.active_keys > 0), text: "Create an API key for the agent", href: "/console/agents" },
    { done: total > 0, text: "Send the first request from your agent", href: "/docs/quickstart" },
  ];
  const setupDone = steps.every((x) => x.done);

  return (
    <>
      <PageTitle title="Dashboard" description={`${org.data?.name ?? "Your organization"}: real decisions from the last 24 hours (UTC, hourly buckets).`} />
      <LoadError error={summary.error ?? agents.error ?? policies.error} />

      {!setupDone && (agents.data || policies.data) && (
        <Panel title="Get started" className="mb-4">
          <ol className="divide-y divide-line">
            {steps.map((st, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span aria-hidden className={`font-mono ${st.done ? "text-citrine" : "text-dim"}`}>{st.done ? "✓" : String(i + 1)}</span>
                <span className={st.done ? "text-muted line-through decoration-line-strong" : "text-soft"}>{st.text}</span>
                {!st.done && (
                  <Link href={st.href} className="ml-auto font-utility text-[10.5px] uppercase tracking-[0.06em] text-stone hover:text-citrine">
                    Open →
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Allowed · 24h", s?.allowed, "text-citrine"],
          ["Denied · 24h", s?.denied, "text-deny"],
          ["Pending approvals", s?.pending_approvals, "text-sand"],
          ["Reserved · last hour", s ? usd(s.reserved_last_hour_usd_micros) : undefined, "text-bone"],
        ].map(([label, value, cls]) => (
          <Panel key={label as string} bodyClassName="px-4 py-4">
            <p className="label !text-[10px]">{label}</p>
            <p className={`mt-2 font-heading text-[28px] font-bold leading-none ${cls}`}>{value ?? "—"}</p>
          </Panel>
        ))}
      </div>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <Panel title="Decisions per hour · UTC">
          {!s ? (
            <Loading what="decisions" />
          ) : s.hourly.length === 0 ? (
            <Empty title="No operations in the last 24 hours">Decisions appear here as soon as an agent calls the API.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-[13px]">
                <thead className="text-left">
                  <tr>{["Hour (UTC)", "Allowed", "Denied", "Review"].map((h) => <th key={h} className={thCls}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {s.hourly.map((h) => (
                    <tr key={h.hour} className="border-b border-line">
                      <td className="px-4 py-2 font-mono text-[12px] text-muted">{h.hour.slice(5, 13).replace("T", " ")}:00</td>
                      <td className="px-4 py-2 font-mono text-citrine">{h.allowed}</td>
                      <td className="px-4 py-2 font-mono text-deny">{h.denied}</td>
                      <td className="px-4 py-2 font-mono text-sand">{h.reviewed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Denials by reason · 24h">
            {!s ? (
              <Loading what="reasons" />
            ) : s.deny_reasons.length === 0 ? (
              <Empty title="No denials" />
            ) : (
              <ul className="divide-y divide-line">
                {s.deny_reasons.map((r) => (
                  <li key={r.reason_code} className="flex items-center justify-between px-4 py-2 text-[13px]">
                    <Link href={`/console/operations?reason_code=${r.reason_code}`} className="hover:text-citrine"><Codes text={r.reason_code} /></Link>
                    <Mono className="text-soft">{r.count}</Mono>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Agents" actions={<Link href="/console/agents" className="font-utility text-[10.5px] uppercase tracking-[0.06em] text-stone hover:text-citrine">Manage →</Link>}>
            {!agents.data ? (
              <Loading what="agents" />
            ) : a.length === 0 ? (
              <Empty title="No agents registered" />
            ) : (
              <ul className="divide-y divide-line">
                {a.map((ag) => (
                  <li key={ag.id} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                    <span className="truncate text-soft">{ag.name}</span>
                    <Pill tone={ag.status === "active" ? "allow" : ag.status === "paused" ? "muted" : "deny"}>{ag.status}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
