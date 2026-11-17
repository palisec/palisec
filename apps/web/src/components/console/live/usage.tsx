"use client";

import Link from "next/link";
import { Empty, Mono, PageTitle, Panel, Pill } from "../kit";
import { ago, LoadError, Loading, thCls } from "./common";
import { useLive } from "./session";

interface KeyUsage {
  id: string;
  label: string;
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
  revoked_at: string | null;
  agent_id: string;
  agent_name: string;
  requests_24h: number;
  requests_7d: number;
  allowed_7d: number;
  denied_7d: number;
  reviewed_7d: number;
}
interface Usage {
  keys: KeyUsage[];
  daily: { day: string; allowed: number; denied: number; reviewed: number }[];
  agent_tool_calls_7d: number;
  webhook_deliveries_7d: number;
}

/** API usage from the ledger. Usage is not billed here, and these numbers are not a bill. */
export function LiveUsage() {
  const u = useLive<Usage>("/usage");
  const d = u.data;
  const max = Math.max(1, ...(d?.daily ?? []).map((x) => x.allowed + x.denied + x.reviewed));
  const total = (d?.keys ?? []).reduce((s, k) => s + k.requests_7d, 0);
  return (
    <>
      <PageTitle title="Usage" description="Requests and outcomes per agent and API key over the last 7 days (UTC), straight from the authorization ledger. Nothing here is billed." />
      <LoadError error={u.error} />
      {!d ? (
        <Loading what="usage" />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["Authorization requests · 7d", total],
              ["PALISEC Agent tool calls · 7d", d.agent_tool_calls_7d],
              ["Webhook deliveries · 7d", d.webhook_deliveries_7d],
            ].map(([k, v]) => (
              <Panel key={k as string} bodyClassName="p-4">
                <p className="label !text-[10px]">{k}</p>
                <p className="mt-2 font-mono text-[26px] text-phosphor">{v}</p>
              </Panel>
            ))}
          </div>
          <Panel title="Daily decisions" bodyClassName="p-4">
            {d.daily.length === 0 ? (
              <p className="text-[12.5px] text-muted">No requests in the last 7 days.</p>
            ) : (
              <ul className="space-y-1.5">
                {d.daily.map((x) => (
                  <li key={x.day} className="grid grid-cols-[88px_minmax(0,1fr)_52px] items-center gap-3 text-[12px]">
                    <Mono className="text-dim">{x.day.slice(5)}</Mono>
                    <span className="flex h-2.5 overflow-hidden rounded-full bg-line" aria-label={`${x.allowed} allowed, ${x.denied} denied, ${x.reviewed} review`}>
                      <span className="bg-allow" style={{ width: `${(x.allowed / max) * 100}%` }} />
                      <span className="bg-deny" style={{ width: `${(x.denied / max) * 100}%` }} />
                      <span className="bg-review" style={{ width: `${(x.reviewed / max) * 100}%` }} />
                    </span>
                    <span className="text-right font-mono text-soft">{x.allowed + x.denied + x.reviewed}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="By API key" bodyClassName="p-0">
            {d.keys.length === 0 ? (
              <Empty title="No API keys yet">Create one in <Link href="/console/integrations" className="text-aqua hover:underline">Integrations</Link>.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[12.5px]">
                  <thead>
                    <tr>
                      {["Key", "Agent", "24h", "7d", "Allowed", "Denied", "Review", "Last used"].map((h) => (
                        <th key={h} className={thCls}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {d.keys.map((k) => (
                      <tr key={k.id} className="text-soft">
                        <td className="px-4 py-2">
                          <Mono className="text-mist">{k.prefix}…</Mono> <span className="text-muted">{k.label}</span>
                          {k.revoked_at && <Pill tone="deny" className="ml-2">revoked</Pill>}
                        </td>
                        <td className="px-4 py-2"><Link href={`/console/agents?id=${k.agent_id}`} className="hover:text-aqua">{k.agent_name}</Link></td>
                        <td className="px-4 py-2 font-mono">{k.requests_24h}</td>
                        <td className="px-4 py-2 font-mono">{k.requests_7d}</td>
                        <td className="px-4 py-2 font-mono text-allow">{k.allowed_7d}</td>
                        <td className="px-4 py-2 font-mono text-deny">{k.denied_7d}</td>
                        <td className="px-4 py-2 font-mono text-review">{k.reviewed_7d}</td>
                        <td className="px-4 py-2 text-muted">{k.last_used_at ? ago(k.last_used_at) : "never"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
