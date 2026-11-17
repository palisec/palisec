"use client";

import Link from "next/link";
import { MAINNET, networkLabel } from "@/lib/networks";
import { shortHex } from "@/lib/units";
import { Codes } from "../../ui";
import { Empty, KV, Mono, PageTitle, Panel, Pill } from "../kit";
import { ago, LoadError, Loading, usd, utc } from "./common";
import { useConsoleSession, useLive } from "./session";

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
  status: "active" | "paused" | "revoked";
  policy_key: string | null;
  policy_version: number | null;
  active_keys: number;
  last_operation_at: string | null;
}
interface PolicyRow {
  id: string;
  name: string;
  policy_key: string;
  status: "draft" | "active" | "disabled";
  active_version: number | null;
  activated_at: string | null;
}
interface AuditEvent {
  seq: string;
  type: string;
  detail: Record<string, unknown>;
  created_at: string;
  actor_address: string | null;
  actor_agent_name: string | null;
}
interface Org {
  name: string;
  emergency_stop: boolean;
}

/** The last 24 whole UTC hours, oldest first, with zero-filled gaps (spec §11.2: real series, defined interval). */
function last24(hourly: Summary["hourly"]) {
  const byHour = new Map(hourly.map((h) => [h.hour, h]));
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  return Array.from({ length: 24 }, (_, i) => {
    const t = new Date(now.getTime() - (23 - i) * 3600_000).toISOString().slice(0, 13) + ":00:00Z";
    return byHour.get(t) ?? { hour: t, allowed: 0, denied: 0, reviewed: 0 };
  });
}

function OutcomeChart({ hourly }: { hourly: Summary["hourly"] }) {
  const series = last24(hourly);
  const max = Math.max(1, ...series.map((h) => h.allowed + h.denied + h.reviewed));
  return (
    <figure className="px-4 pb-4 pt-3">
      <div className="flex h-36 items-end gap-[3px]" role="img" aria-label="Operations per hour for the last 24 hours, UTC">
        {series.map((h) => {
          const total = h.allowed + h.denied + h.reviewed;
          const seg = (n: number) => `${(n / max) * 100}%`;
          return (
            <Link
              key={h.hour}
              href={h.denied ? `/console/operations?decision=DENY` : "/console/operations"}
              title={`${h.hour.slice(11, 13)}:00 UTC · ${h.allowed} allowed · ${h.denied} denied · ${h.reviewed} review`}
              className="flex h-full min-w-0 flex-1 flex-col justify-end rounded-[2px] transition-opacity hover:opacity-80"
            >
              {total === 0 ? <span className="block h-px bg-line-strong" /> : null}
              <span className="block bg-review/80" style={{ height: seg(h.reviewed) }} />
              <span className="block bg-deny" style={{ height: seg(h.denied) }} />
              <span className="block bg-allow" style={{ height: seg(h.allowed) }} />
            </Link>
          );
        })}
      </div>
      <figcaption className="mt-2 flex flex-wrap justify-between gap-2 font-utility text-[12px] text-dim">
        <span>{series[0]!.hour.slice(11, 13)}:00 UTC</span>
        <span className="flex gap-3">
          <span><span aria-hidden className="text-allow">■</span> Allowed</span>
          <span><span aria-hidden className="text-deny">■</span> Denied</span>
          <span><span aria-hidden className="text-review">■</span> Review</span>
        </span>
        <span>now</span>
      </figcaption>
    </figure>
  );
}

const EVENT_TONE = (t: string) =>
  t.endsWith(".denied") || t.endsWith(".revoked") || t === "org.emergency_stop.activated" ? "deny" : t.endsWith(".approved") ? "allow" : t.endsWith(".pending_approval") ? "review" : "muted";

function eventHref(e: AuditEvent) {
  const op = typeof e.detail.operation_id === "string" ? e.detail.operation_id : null;
  return op ? `/console/operations?id=${op}` : `/console/audit?seq=${e.seq}`;
}

export function LiveDashboard() {
  const summary = useLive<Summary>("/summary");
  const agents = useLive<{ agents: AgentRow[] }>("/agents");
  const policies = useLive<{ policies: PolicyRow[] }>("/policies");
  const events = useLive<{ events: AuditEvent[] }>("/audit-events?kind=security&limit=8");
  const health = useLive<{ components: Record<string, string> }>("/health");
  const org = useLive<Org>("/organization");
  const s = summary.data;
  const a = agents.data?.agents ?? [];
  const p = policies.data?.policies ?? [];
  const total = s ? s.allowed + s.denied + s.reviewed : 0;
  const defaultName = org.data?.name.startsWith("Organization 0x") ?? false;

  const steps = [
    { done: !defaultName, text: "Name your organization", href: "/console/settings" },
    { done: p.length > 0, text: "Create a policy for your agent's smart account", href: "/console/policies" },
    { done: p.some((x) => x.status === "active"), text: "Validate and activate it", href: "/console/policies" },
    { done: a.length > 0, text: "Register the agent and bind it to the policy", href: "/console/agents" },
    { done: a.some((x) => x.active_keys > 0), text: "Create an API key for the agent", href: "/console/agents" },
    { done: total > 0, text: "Send the first request from your agent", href: "/docs/quickstart" },
  ];
  const loaded = agents.data && policies.data && org.data;
  const setupDone = steps.every((x) => x.done);
  const c = health.data?.components;
  const { network } = useConsoleSession();
  const cosigner = network === MAINNET ? c?.mainnet_signer === "mainnet_cosigner" : c?.signer === "testnet_cosigner";

  return (
    <>
      <PageTitle title="Dashboard" description={`${org.data?.name ?? "Your organization"} · decisions from the last 24 hours, UTC.`} />
      <LoadError error={summary.error ?? agents.error ?? policies.error} />

      {loaded && !setupDone && (
        <Panel title={`Get started · ${steps.filter((x) => x.done).length} of ${steps.length}`} className="mb-4">
          <ol className="divide-y divide-line">
            {steps.map((st, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span aria-hidden className={`font-mono ${st.done ? "text-aqua" : "text-dim"}`}>{st.done ? "✓" : String(i + 1)}</span>
                <span className={st.done ? "text-muted line-through decoration-line-strong" : "text-soft"}>{st.text}</span>
                {!st.done && (
                  <Link href={st.href} className="ml-auto font-utility text-[12.5px] text-silver hover:text-aqua">Open →</Link>
                )}
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Allowed · 24h", s?.allowed, "text-aqua", "/console/operations?decision=ALLOW"],
          ["Denied · 24h", s?.denied, "text-deny", "/console/operations?decision=DENY"],
          ["Pending approvals", s?.pending_approvals, "text-review", "/console/approvals"],
          ["Reserved · last hour", s ? usd(s.reserved_last_hour_usd_micros) : undefined, "text-phosphor", "/console/operations?decision=ALLOW"],
        ].map(([label, value, cls, href]) => (
          <Link key={label as string} href={href as string} className="panel block px-4 py-4 transition-colors hover:border-line-strong">
            <p className="label !text-[10px]">{label}</p>
            <p className={`mt-2 font-heading text-[28px] font-bold leading-none ${cls}`}>{value ?? "—"}</p>
          </Link>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] text-muted">
        Reserved is the exposure (value plus fee bound, in USD) held by authorizations in the rolling hour. Spent amounts need receipt reconciliation, which is not deployed.
      </p>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <div className="min-w-0 space-y-4">
          <Panel title="Execution outcomes · 24h · UTC · hourly">
            {!s ? <Loading what="decisions" /> : total === 0 ? <Empty title="No operations in the last 24 hours">Decisions appear here as soon as an agent calls the API.</Empty> : <OutcomeChart hourly={s.hourly} />}
          </Panel>

          <Panel title="Recent security events" actions={<Link href="/console/audit" className="font-utility text-[12.5px] text-silver hover:text-aqua">Full audit →</Link>}>
            {!events.data ? (
              <Loading what="events" />
            ) : events.data.events.length === 0 ? (
              <Empty title="No security events yet">Denials, approvals, pauses, revocations and emergency stops appear here.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {events.data.events.map((e) => (
                  <li key={e.seq}>
                    <Link href={eventHref(e)} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-raised/40">
                      <Pill tone={EVENT_TONE(e.type)}>{e.type}</Pill>
                      {typeof e.detail.reason_code === "string" && <Codes text={e.detail.reason_code} />}
                      <span className="text-muted">{e.actor_agent_name ?? (e.actor_address ? shortHex(e.actor_address) : "")}</span>
                      <Mono className="ml-auto text-[11.5px] text-dim">{ago(e.created_at)}</Mono>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Agents" actions={<Link href="/console/agents" className="font-utility text-[12.5px] text-silver hover:text-aqua">Manage →</Link>}>
            {!agents.data ? (
              <Loading what="agents" />
            ) : a.length === 0 ? (
              <Empty title="No agents registered" />
            ) : (
              <ul className="divide-y divide-line">
                {a.map((ag) => (
                  <li key={ag.id} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                    <span className="min-w-0">
                      <span className="block truncate text-soft">{ag.name}</span>
                      <Mono className="text-dim">{ag.policy_key ? `${ag.policy_key}${ag.policy_version ? ` v${ag.policy_version}` : ""}` : "no policy"}</Mono>
                    </span>
                    <Pill tone={ag.status === "active" ? "allow" : ag.status === "paused" ? "muted" : "deny"}>
                      <span aria-hidden>{ag.status === "active" ? "●" : ag.status === "paused" ? "❚❚" : "■"}</span>
                      {ag.status}
                    </Pill>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Policies" actions={<Link href="/console/policies" className="font-utility text-[12.5px] text-silver hover:text-aqua">Edit →</Link>}>
            {!policies.data ? (
              <Loading what="policies" />
            ) : p.length === 0 ? (
              <Empty title="No policies yet" />
            ) : (
              <ul className="divide-y divide-line">
                {p.map((po) => (
                  <li key={po.id} className="px-4 py-2 text-[13px]">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-soft">{po.name}</span>
                      <Pill tone={po.status === "active" ? "allow" : po.status === "disabled" ? "deny" : "muted"}>{po.status}{po.active_version ? ` · v${po.active_version}` : ""}</Pill>
                    </span>
                    <span className="text-[11.5px] text-muted">{po.activated_at ? `Activated ${utc(po.activated_at)}` : "Never activated"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Denials by reason · 24h">
            {!s ? (
              <Loading what="reasons" />
            ) : s.deny_reasons.length === 0 ? (
              <Empty title="No denials" />
            ) : (
              <ul className="divide-y divide-line">
                {s.deny_reasons.map((r) => (
                  <li key={r.reason_code}>
                    <Link href={`/console/operations?reason_code=${r.reason_code}`} className="flex items-center justify-between px-4 py-2 text-[13px] hover:bg-raised/40">
                      <Codes text={r.reason_code} />
                      <Mono className="text-soft">{r.count}</Mono>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Connectivity" bodyClassName="px-4 py-2">
            <KV
              rows={[
                ["Authorization state", c ? <Pill key="d" tone={c.database === "ok" ? "allow" : "deny"}>{c.database}</Pill> : "…"],
                ["Policy engine", c ? <Pill key="p" tone={c.policy_engine === "ok" ? "allow" : "deny"}>{c.policy_engine === "ok" ? "rust + reference · agree" : c.policy_engine}</Pill> : "…"],
                ["Network", <span key="c" className="text-soft">{networkLabel(network)}</span>],
                ["Co-signer", c ? <Pill key="s" tone={cosigner ? "allow" : "muted"}>{cosigner ? "configured" : "○ not configured"}</Pill> : "…"],
                ["Bundler", c ? <Pill key="b" tone={c.bundler === "configured" ? "allow" : "muted"}>{c.bundler === "configured" ? "configured" : "○ not configured"}</Pill> : "…"],
              ]}
            />
          </Panel>
        </div>
      </div>
    </>
  );
}
