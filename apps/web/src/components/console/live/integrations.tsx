"use client";

import Link from "next/link";
import { useState } from "react";
import { CodeBlock, CopyButton } from "../../copy-button";
import { Btn, Confirm, Empty, inputCls, Mono, Notice, PageTitle, Panel, Pill } from "../kit";
import { ago, LoadError, Loading, useAction, utc } from "./common";
import { api, can, useConsoleSession, useLive } from "./session";

const SCOPES = [
  ["operations:write", "Request authorizations and dry runs; withdraw pending approvals"],
  ["operations:read", "Read its own operations and their status"],
  ["policy:read", "Read the policy version it is evaluated against"],
  ["audit:read", "Read its own audit events"],
  ["mcp", "Connect through the MCP server"],
] as const;

interface Credential {
  id: string;
  label: string;
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
}
interface Integration {
  id: string;
  name: string;
  framework: string | null;
  status: string;
  account: string;
  policy_key: string | null;
  policy_version: number | null;
  credentials: Credential[];
  last_activity_at: string | null;
  requests_24h: number;
  denied_24h: number;
}
interface Webhook {
  id: string;
  url: string;
  events: string[];
  status: string;
  secret_prefix: string;
  last_delivery_at: string | null;
  consecutive_failures: number;
  deliveries_24h: number;
  failed_24h: number;
}
interface Delivery {
  id: string;
  event_id: string;
  event_type: string;
  status: string;
  attempts: number;
  last_status: number | null;
  last_error: string | null;
  created_at: string;
}

function SecretOnce({ secret, what }: { secret: string; what: string }) {
  return (
    <div className="rounded-[8px] border border-review/50 bg-review/[0.05] p-3">
      <p className="font-utility text-[10.5px] uppercase tracking-[0.08em] text-review">◆ Copy this {what} now. It is not shown again.</p>
      <div className="mt-2 flex items-center gap-2">
        <Mono className="min-w-0 flex-1 break-all text-[12px] text-mist">{secret}</Mono>
        <CopyButton text={secret} label={`Copy ${what}`} />
      </div>
    </div>
  );
}

function KeyRow({ c, onChange }: { c: Credential; onChange: () => void }) {
  const { org } = useConsoleSession();
  const { run, notice } = useAction();
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <li className="space-y-2 py-2">
      <div className="flex flex-col gap-2 text-[12.5px] sm:flex-row sm:items-center sm:justify-between">
        <span className="min-w-0">
          <Mono className="text-soft">{c.prefix}…</Mono> <span className="text-muted">{c.label}</span>
          <span className="mt-1 flex flex-wrap gap-1">
            {c.scopes.map((s) => (
              <Pill key={s} tone="info">{s}</Pill>
            ))}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="font-utility text-[10px] uppercase tracking-[0.06em] text-dim">{c.last_used_at ? `used ${ago(c.last_used_at)}` : "never used"}</span>
          {can.manage(org?.role) && (
            <>
              <Confirm
                label="Rotate"
                variant="quiet"
                prompt="Issues a new secret with the same scopes and revokes this key at once. Update your agent before it next calls PALISEC."
                confirmLabel="Rotate key"
                onConfirm={() => run(() => api<{ secret: string }>(`/credentials/${c.id}/rotate`, { method: "POST" })).then((r) => r && (setSecret(r.secret), onChange()))}
              />
              <Confirm label="Revoke" variant="quiet" prompt="The key stops working immediately." confirmLabel="Revoke key" onConfirm={() => run(() => api(`/credentials/${c.id}/revoke`, { method: "POST" }), "Key revoked.").then(onChange)} />
            </>
          )}
        </span>
      </div>
      {secret && <SecretOnce secret={secret} what="new API key" />}
      {notice}
    </li>
  );
}

function NewKey({ agentId, onCreated }: { agentId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<string[]>(SCOPES.map((s) => s[0]));
  const [secret, setSecret] = useState<string | null>(null);
  const { run, busy, notice } = useAction();
  if (secret) return <SecretOnce secret={secret} what="API key" />;
  if (!open) return <Btn variant="quiet" onClick={() => setOpen(true)}>New scoped key</Btn>;
  return (
    <div className="space-y-2 rounded-[6px] border border-line-strong p-3">
      <input aria-label="Key label" className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label, e.g. production" />
      <fieldset className="space-y-1">
        <legend className="label mb-1">Scopes (least privilege)</legend>
        {SCOPES.map(([s, d]) => (
          <label key={s} className="flex items-start gap-2 text-[12px] text-soft">
            <input type="checkbox" className="mt-0.5 accent-[#9cf6ee]" checked={scopes.includes(s)} onChange={(e) => setScopes((x) => (e.target.checked ? [...x, s] : x.filter((y) => y !== s)))} />
            <span><Mono className="text-mist">{s}</Mono> · {d}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex gap-2">
        <Btn variant="primary" disabled={busy || scopes.length === 0} onClick={() => run(() => api<{ secret: string }>(`/agents/${agentId}/credentials`, { method: "POST", body: { label: label || "API key", scopes } })).then((r) => r && (setSecret(r.secret), onCreated()))}>
          Create key
        </Btn>
        <Btn variant="quiet" onClick={() => setOpen(false)}>Cancel</Btn>
      </div>
      {notice}
    </div>
  );
}

function Deliveries({ webhookId }: { webhookId: string }) {
  const d = useLive<{ deliveries: Delivery[] }>(`/webhooks/${webhookId}/deliveries`);
  const { run, notice } = useAction();
  const { org } = useConsoleSession();
  if (!d.data) return <Loading what="deliveries" />;
  if (!d.data.deliveries.length) return <p className="py-2 text-[12px] text-muted">No deliveries yet.</p>;
  return (
    <>
      {notice}
      <ul className="divide-y divide-line">
        {d.data.deliveries.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[12px]">
            <span>
              <Mono className="text-soft">{x.event_type}</Mono> <span className="text-dim">· {utc(x.created_at)}</span>
            </span>
            <span className="flex items-center gap-2">
              {x.last_error && <span className="max-w-[200px] truncate text-[11px] text-muted" title={x.last_error}>{x.last_error}</span>}
              <Pill tone={x.status === "delivered" ? "allow" : x.status === "failed" ? "deny" : "muted"}>{x.status} · {x.attempts}×</Pill>
              {x.status === "failed" && can.manage(org?.role) && (
                <Btn variant="quiet" onClick={() => run(() => api(`/webhook-deliveries/${x.id}/redeliver`, { method: "POST" }), "Sent again with the same event ID.").then(d.reload)}>Redeliver</Btn>
              )}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Webhooks() {
  const { org } = useConsoleSession();
  const w = useLive<{ webhooks: Webhook[]; event_types: string[] }>("/webhooks");
  const { run, busy, notice } = useAction();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["operation.denied", "operation.review_required", "security.finding"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Panel title="Webhooks" id="webhooks" bodyClassName="p-4 space-y-4">
      <p className="text-[12.5px] leading-relaxed text-muted">
        Signed events (HMAC-SHA256 over <Mono>timestamp.body</Mono>) for decisions, approvals, pauses, emergency stops and security findings. Retries reuse the event ID, so deduplicate on{" "}
        <Mono>palisec-event-id</Mono>. Verify with <Mono>verifyWebhook</Mono> in the SDKs. Only public HTTPS endpoints are accepted.
      </p>
      <LoadError error={w.error} />
      {notice}
      {!w.data ? (
        <Loading what="webhooks" />
      ) : (
        <ul className="divide-y divide-line">
          {w.data.webhooks.map((h) => (
            <li key={h.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <Mono className="block break-all text-[12.5px] text-mist">{h.url}</Mono>
                  <span className="mt-1 flex flex-wrap gap-1">{h.events.map((e) => <Pill key={e} tone="muted">{e}</Pill>)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Pill tone={h.status === "active" ? (h.consecutive_failures ? "review" : "allow") : "deny"}>{h.status}{h.consecutive_failures ? ` · ${h.consecutive_failures} failing` : ""}</Pill>
                  <span className="font-utility text-[10px] uppercase tracking-[0.06em] text-dim">{h.deliveries_24h} / 24h · {h.failed_24h} failed</span>
                  <Btn variant="quiet" onClick={() => setOpen(open === h.id ? null : h.id)}>{open === h.id ? "Hide" : "Deliveries"}</Btn>
                  {can.manage(org?.role) && (
                    <>
                      <Btn variant="quiet" disabled={busy} onClick={() => run(() => api<{ status: string }>(`/webhooks/${h.id}/test`, { method: "POST" }), (r) => `Test ping ${r?.status ?? "sent"}.`).then(w.reload)}>Test</Btn>
                      <Btn variant="quiet" disabled={busy} onClick={() => run(() => api(`/webhooks/${h.id}`, { method: "PATCH", body: { status: h.status === "active" ? "disabled" : "active" } })).then(w.reload)}>{h.status === "active" ? "Disable" : "Enable"}</Btn>
                      <Confirm label="Delete" variant="quiet" prompt="Deliveries to this endpoint stop and its history is removed." confirmLabel="Delete webhook" onConfirm={() => run(() => api(`/webhooks/${h.id}`, { method: "DELETE" }), "Webhook deleted.").then(w.reload)} />
                    </>
                  )}
                </span>
              </div>
              {open === h.id && <Deliveries webhookId={h.id} />}
            </li>
          ))}
          {w.data.webhooks.length === 0 && <li className="py-2 text-[12.5px] text-muted">No webhooks.</li>}
        </ul>
      )}
      {secret && <SecretOnce secret={secret} what="signing secret" />}
      {can.manage(org?.role) && w.data && (
        <div className="space-y-2 border-t border-line pt-3">
          <p className="label">Add an endpoint</p>
          <input aria-label="Endpoint URL" className={inputCls} value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="https://your-service.example/palisec" spellCheck={false} />
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {w.data.event_types.map((e) => (
              <label key={e} className="flex items-center gap-1.5 text-[12px] text-soft">
                <input type="checkbox" className="accent-[#9cf6ee]" checked={events.includes(e)} onChange={(ev) => setEvents((x) => (ev.target.checked ? [...x, e] : x.filter((y) => y !== e)))} />
                <Mono>{e}</Mono>
              </label>
            ))}
          </div>
          <Btn variant="primary" disabled={busy || !url.startsWith("https://") || events.length === 0} onClick={() => run(() => api<{ secret: string }>("/webhooks", { method: "POST", body: { url, events } })).then((r) => r && (setSecret(r.secret), setUrl(""), w.reload()))}>
            Add webhook
          </Btn>
        </div>
      )}
    </Panel>
  );
}

const MCP_CONFIG = JSON.stringify(
  { mcpServers: { palisec: { type: "http", url: "https://palisec.tech/api/mcp", headers: { Authorization: "Bearer ${PALISEC_API_KEY}" } } } },
  null,
  2,
);

export function LiveIntegrations() {
  const list = useLive<{ integrations: Integration[]; webhooks: { active: number; disabled: number; failing: number } }>("/integrations");
  return (
    <>
      <PageTitle
        title="Integrations"
        description="Independent agents connect through the SDKs, the REST API or MCP. Each is a registered agent with scoped, revocable keys; PALISEC evaluates every proposal the same way, whatever the interface."
      />
      <LoadError error={list.error} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel title="Connected agents" bodyClassName="p-0">
          {!list.data ? (
            <Loading what="integrations" />
          ) : list.data.integrations.length === 0 ? (
            <Empty title="No agents yet">
              Register one in <Link href="/console/agents" className="text-aqua underline-offset-4 hover:underline">Agents</Link>, then create a scoped key here.
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {list.data.integrations.map((i) => (
                <li key={i.id} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <Link href={`/console/agents?id=${i.id}`} className="text-[14px] text-mist underline-offset-4 hover:underline">{i.name}</Link>
                      <span className="ml-2 font-utility text-[10.5px] uppercase tracking-[0.06em] text-dim">{i.framework ?? "framework not set"}</span>
                      <Mono className="block text-[11.5px] text-dim">{i.account}</Mono>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Pill tone={i.status === "active" ? "allow" : i.status === "paused" ? "review" : "deny"}>{i.status}</Pill>
                      <Pill tone="muted">{i.policy_key ? `${i.policy_key} v${i.policy_version ?? "—"}` : "no policy"}</Pill>
                    </span>
                  </div>
                  <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-[6px] border border-line bg-line text-[12px]">
                    {([["Last activity", i.last_activity_at ? ago(i.last_activity_at) : "never", ""], ["Requests 24h", String(i.requests_24h), "font-mono"], ["Denied 24h", String(i.denied_24h), `font-mono ${i.denied_24h ? "text-deny" : ""}`]] as const).map(([k, v, cls]) => (
                      <div key={k} className="min-w-0 bg-ink px-3 py-1.5">
                        <dt className="label truncate !text-[9.5px]">{k}</dt>
                        <dd className={`truncate text-soft ${cls}`}>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <ul className="divide-y divide-line">
                    {i.credentials.map((c) => (
                      <KeyRow key={c.id} c={c} onChange={list.reload} />
                    ))}
                  </ul>
                  {i.status !== "revoked" && <NewKeyGate agentId={i.id} onCreated={list.reload} />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel title="MCP" id="mcp" bodyClassName="p-4 space-y-2">
            <p className="text-[12.5px] leading-relaxed text-muted">
              Remote MCP server (Streamable HTTP) at <Mono>https://palisec.tech/api/mcp</Mono>. Authenticate with an agent key that has the <Mono>mcp</Mono> scope; each tool also checks
              its own scope. Proposals go through the same authorization path as the REST API. There is no activation, approval or signing tool.
            </p>
            <CodeBlock code={MCP_CONFIG} title="mcp.json" />
            <Link href="/docs/mcp" className="text-[12.5px] text-aqua underline-offset-4 hover:underline">MCP documentation</Link>
          </Panel>
          <Webhooks />
          {list.data && (
            <Notice tone={list.data.webhooks.failing ? "review" : "allow"}>
              {list.data.webhooks.active} active webhook(s){list.data.webhooks.failing ? `, ${list.data.webhooks.failing} recent failure(s)` : ""}.
            </Notice>
          )}
        </div>
      </div>
    </>
  );
}

function NewKeyGate({ agentId, onCreated }: { agentId: string; onCreated: () => void }) {
  const { org } = useConsoleSession();
  return can.manage(org?.role) ? <NewKey agentId={agentId} onCreated={onCreated} /> : null;
}
