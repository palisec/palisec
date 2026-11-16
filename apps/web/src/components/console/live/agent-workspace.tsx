"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Btn, Empty, inputCls, Mono, Notice, PageTitle, Panel, Pill, Segmented } from "../kit";
import { ago, LoadError, Loading, useAction } from "./common";
import { api, can, useConsoleSession, useLive } from "./session";

interface ToolInfo {
  name: string;
  description: string;
  risk: "read" | "draft" | "action";
  min_autonomy: number;
  role: string;
  available: boolean;
}
interface ToolsResponse {
  config: { enabled: boolean; autonomy_level: 0 | 1 | 2; disabled_tools: string[]; updated_at: string | null; updated_by: string | null };
  model: { provider: string; model: string; configured: boolean };
  tools: ToolInfo[];
}
interface Evidence {
  type: string;
  id: string;
  label?: string;
}
interface ToolCall {
  id: string;
  tool: string;
  risk: string;
  status: "ok" | "error" | "refused";
  error: string | null;
  duration_ms: number;
  output: unknown;
  input: unknown;
}
interface ActionRequest {
  id: string;
  action: string;
  impact: string;
  status: string;
  expires_at: string;
  decided_by: string | null;
}
interface Run {
  id: string;
  title: string;
  status: string;
  model: string;
  provider: string;
  error: string | null;
  messages: { role: "user" | "assistant"; content: string }[];
  tool_calls: ToolCall[];
  action_requests: ActionRequest[];
  evidence: Evidence[];
  unverified_citations: { type: string; id: string }[];
  can_continue: boolean;
  paused?: boolean;
}
interface RunRow {
  id: string;
  title: string;
  status: string;
  updated_at: string;
  started_by: string;
  pending_actions: number;
}

const LEVELS = ["Observe", "Assist", "Confirmed actions"] as const;
const LEVEL_TEXT = [
  "Reads records and explains. Changes nothing.",
  "Also drafts and simulates policies and prepares actions. Nothing is saved or changed.",
  "Can also create requests (emergency stop, pause, saving a policy draft) that a member with the right role must confirm here.",
];

/** Where a cited record lives in the console. */
function recordHref(type: string, id: string) {
  if (type === "operation") return `/console/operations?op=${id}`;
  if (type === "policy") return `/console/policies?id=${id}`;
  if (type === "agent") return `/console/agents?id=${id}`;
  if (type === "finding") return `/console/security-events#${id}`;
  if (type === "audit" || type === "audit_event") return `/console/audit`;
  if (type === "documentation") return id.startsWith("/") ? id : "/docs";
  return null;
}

/** Answer text with [type:id] citations turned into links. Verified ones are solid, others flagged. */
function Answer({ text, evidence }: { text: string; evidence: Evidence[] }) {
  const parts: ReactNode[] = [];
  const re = /\[(operation|policy|agent|finding|audit):([0-9a-f-]{36})\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    parts.push(text.slice(last, m.index));
    const verified = evidence.some((e) => e.id === m[2]);
    const href = recordHref(m[1]!, m[2]!);
    parts.push(
      href && verified ? (
        <Link key={m.index} href={href} className="mx-0.5 rounded-[4px] bg-aqua/[0.08] px-1 font-mono text-[11px] text-aqua underline-offset-2 hover:underline">
          {m[1]}·{m[2]!.slice(0, 8)}
        </Link>
      ) : (
        <span key={m.index} title="Not backed by any tool result in this run" className="mx-0.5 rounded-[4px] border border-dashed border-deny/60 px-1 font-mono text-[11px] text-deny">
          unverified {m[1]}·{m[2]!.slice(0, 8)}
        </span>
      ),
    );
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(text.slice(last));
  return <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-soft">{parts}</div>;
}

interface DecisionOutput {
  decision: "ALLOW" | "DENY" | "REQUIRES_HUMAN_SIGNATURE";
  reason_code: string | null;
  reason?: string | null;
  guidance?: string | null;
  message?: string;
  checks: { id: string; status: string; detail: string }[];
}
const isDecision = (o: unknown): o is DecisionOutput => Boolean(o && typeof o === "object" && "decision" in o && Array.isArray((o as DecisionOutput).checks));

/** A decision explained in order: outcome, reason, guidance, then every check. */
function DecisionSummary({ output }: { output: unknown }) {
  if (!isDecision(output)) return null;
  const tone = output.decision === "ALLOW" ? "allow" : output.decision === "DENY" ? "deny" : "review";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={tone}>{output.decision === "REQUIRES_HUMAN_SIGNATURE" ? "needs approval" : output.decision}</Pill>
        {output.reason_code && <Mono className="text-mist">{output.reason_code}</Mono>}
        {output.reason && <span className="text-[13px] text-soft">{output.reason}</span>}
      </div>
      {output.guidance && <p className="text-[13px] leading-relaxed text-muted">{output.guidance}</p>}
      <ol className="divide-y divide-line rounded-[6px] border border-line">
        {output.checks.map((c) => (
          <li key={c.id} className="flex gap-3 px-3 py-1.5 text-[12px]">
            <span className={`w-14 shrink-0 font-mono ${c.status === "pass" ? "text-allow" : c.status === "fail" ? "text-deny" : c.status === "review" ? "text-review" : "text-dim"}`}>{c.status}</span>
            <span className="min-w-0 text-soft">
              <Mono className="text-mist">{c.id}</Mono> · {c.detail}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const QUICK: { label: string; tool: string; needs?: "operation" | "code" | "agent" }[] = [
  { label: "Security state", tool: "get_account_security_state" },
  { label: "Open findings", tool: "get_security_events" },
  { label: "Integration status", tool: "get_integration_status" },
  { label: "Explain an operation", tool: "get_authorization_decision", needs: "operation" },
  { label: "Explain an error code", tool: "explain_error_code", needs: "code" },
  { label: "Integration health", tool: "inspect_integration_health", needs: "agent" },
];

export function LiveAgentWorkspace() {
  const { org } = useConsoleSession();
  const tools = useLive<ToolsResponse>("/agent/tools");
  const runs = useLive<{ runs: RunRow[] }>("/agent/runs");
  const [run, setRun] = useState<Run | null>(null);
  const [direct, setDirect] = useState<{ tool: string; status: string; output: unknown; error?: string; evidence: Evidence[] } | null>(null);
  const [text, setText] = useState("");
  const [arg, setArg] = useState("");
  const [working, setWorking] = useState(false);
  const { run: act, busy, notice } = useAction();
  const endRef = useRef<HTMLDivElement>(null);

  const t = tools.data;
  const modelReady = Boolean(t?.model.configured && t.config.enabled);

  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [run?.messages.length]);

  async function advance(r: Run) {
    let cur = r;
    for (let i = 0; i < 5 && cur.can_continue && !cur.paused; i++) cur = await api<Run>(`/agent/runs/${cur.id}/continue`, { method: "POST" });
    return cur;
  }

  async function send() {
    const message = text.trim();
    if (!message) return;
    setWorking(true);
    setDirect(null);
    const r = await act(async () => advance(run ? await api<Run>(`/agent/runs/${run.id}/messages`, { method: "POST", body: { message } }) : await api<Run>("/agent/runs", { method: "POST", body: { message } })));
    setWorking(false);
    if (r) {
      setRun(r);
      setText("");
      runs.reload();
    }
  }

  async function open(id: string) {
    setDirect(null);
    const r = await act(() => api<Run>(`/agent/runs/${id}`));
    if (r) setRun(r);
  }

  async function quick(q: (typeof QUICK)[number]) {
    const input =
      q.needs === "operation" ? { operation_id: arg.trim() } : q.needs === "code" ? { code: arg.trim().toUpperCase() } : q.needs === "agent" ? { agent_id: arg.trim() } : {};
    const r = await act(() => api<{ status: string; output: unknown; error?: string; evidence: Evidence[] }>(`/agent/tools/${q.tool}`, { method: "POST", body: { input } }));
    if (r) setDirect({ tool: q.tool, ...r });
  }

  async function decide(id: string, decision: "confirm" | "reject") {
    await act(() => api(`/agent/actions/${id}/${decision}`, { method: "POST" }), decision === "confirm" ? "Confirmed. The action ran under your account." : "Rejected. Nothing changed.");
    if (run) setRun(await api<Run>(`/agent/runs/${run.id}`));
  }

  async function setLevel(level: string) {
    await act(() => api("/agent/configuration", { method: "PATCH", body: { autonomy_level: Number(level) } }), "Autonomy level updated (audited).");
    tools.reload();
  }

  const evidence = direct ? direct.evidence : (run?.evidence ?? []);

  return (
    <>
      <PageTitle
        title="PALISEC Agent"
        description="Security intelligence, policy engineering and operations assistance over your real PALISEC records. The agent cannot authorize, approve, sign or activate anything: the policy engine decides, and actions need your confirmation."
      />
      <LoadError error={tools.error} />
      {t && !t.model.configured && (
        <div className="mb-4">
          <Notice tone="review">
            The model is not configured on this deployment (PALISEC_AGENT_API_KEY), so conversation is off. Quick investigations below run the same tools directly, without AI.
          </Notice>
        </div>
      )}
      {t && !t.config.enabled && (
        <div className="mb-4">
          <Notice tone="deny">The PALISEC Agent is disabled for this organization. An admin can enable it below.</Notice>
        </div>
      )}
      {notice && <div className="mb-4">{notice}</div>}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
        {/* ---------------------------------------------------------------- left */}
        <div className="space-y-4">
          <Panel title="Conversations" actions={<Btn variant="quiet" onClick={() => { setRun(null); setDirect(null); }}>New</Btn>} bodyClassName="max-h-[320px] overflow-y-auto">
            {!runs.data ? (
              <Loading what="conversations" />
            ) : runs.data.runs.filter((r) => !r.title.startsWith("Direct:")).length === 0 ? (
              <p className="px-4 py-4 text-[12.5px] text-muted">No conversations yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {runs.data.runs
                  .filter((r) => !r.title.startsWith("Direct:"))
                  .map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => open(r.id)} aria-pressed={run?.id === r.id} className={`block w-full px-4 py-2.5 text-left transition-colors hover:bg-raised/60 ${run?.id === r.id ? "bg-raised" : ""}`}>
                        <span className="line-clamp-2 text-[12.5px] text-mist">{r.title}</span>
                        <span className="mt-0.5 flex items-center gap-2 font-utility text-[12px] text-dim">
                          {ago(r.updated_at)}
                          {r.pending_actions > 0 && <span className="text-amber">{r.pending_actions} to confirm</span>}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </Panel>
          <Panel title="Quick investigations" bodyClassName="p-4 space-y-2.5">
            <input aria-label="Operation ID, error code or agent ID" className={inputCls} value={arg} onChange={(e) => setArg(e.target.value)} placeholder="Operation ID · PS_ code · agent ID" spellCheck={false} />
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map((q) => (
                <Btn key={q.tool} variant="quiet" disabled={busy || (Boolean(q.needs) && !arg.trim())} onClick={() => quick(q)}>
                  {q.label}
                </Btn>
              ))}
            </div>
            <p className="text-[11.5px] leading-relaxed text-muted">Runs one tool directly against your records. Recorded in agent activity like any tool call.</p>
          </Panel>
        </div>

        {/* ---------------------------------------------------------------- center */}
        <Panel title={direct ? `Tool · ${direct.tool}` : (run?.title ?? "Ask the PALISEC Agent")} bodyClassName="flex min-h-[420px] flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
            {direct ? (
              <div className="space-y-2">
                <Pill tone={direct.status === "ok" ? "allow" : "deny"}>{direct.status}</Pill>
                {direct.error && <p className="text-[13px] text-deny">{direct.error}</p>}
                <DecisionSummary output={direct.output} />
                <details open={!isDecision(direct.output)}>
                  <summary className="cursor-pointer font-utility text-[12.5px] text-silver">Raw result</summary>
                  <pre className="mt-2 overflow-x-auto rounded-[6px] border border-line bg-ink p-3 font-mono text-[11.5px] leading-relaxed text-soft">{JSON.stringify(direct.output, null, 2)}</pre>
                </details>
              </div>
            ) : !run ? (
              <Empty title="Start an investigation">
                <ul className="mt-2 space-y-1 text-left text-[12.5px] text-muted">
                  <li>“Why was the last transaction from my trading agent denied?”</li>
                  <li>“Draft a policy: $500 an hour on this token, approval above $100.”</li>
                  <li>“Anything unusual in the last 24 hours?”</li>
                  <li>“Show me how to integrate with Python.”</li>
                </ul>
              </Empty>
            ) : (
              <>
                {run.messages.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="ml-auto max-w-[85%] rounded-[10px] rounded-br-[4px] border border-line-strong bg-raised px-3.5 py-2.5 text-[13.5px] text-mist">
                      {m.content}
                    </div>
                  ) : (
                    <div key={i} className="max-w-[95%] border-l-2 border-aqua/50 pl-3.5">
                      <p className="label mb-1 !text-[9.5px]">PALISEC Agent</p>
                      <Answer text={m.content} evidence={run.evidence} />
                    </div>
                  ),
                )}
                {run.tool_calls.length > 0 && (
                  <details className="rounded-[6px] border border-line">
                    <summary className="cursor-pointer px-3 py-2 font-utility text-[12.5px] text-silver">Tool activity · {run.tool_calls.length}</summary>
                    <ul className="divide-y divide-line border-t border-line">
                      {run.tool_calls.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12px]">
                          <Mono className="text-soft">{c.tool}</Mono>
                          <span className="flex items-center gap-2">
                            {c.error && <span className="max-w-[260px] truncate text-[11px] text-muted" title={c.error}>{c.error}</span>}
                            <Pill tone={c.status === "ok" ? "allow" : c.status === "refused" ? "deny" : "review"}>{c.status}</Pill>
                            <span className="font-mono text-[10.5px] text-dim">{c.duration_ms}ms</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {run.action_requests.map((a) => (
                  <div key={a.id} className="rounded-[8px] border border-amber/50 bg-amber/[0.05] p-3">
                    <p className="font-utility text-[12.5px] font-semibold text-amber">Needs your confirmation · {a.action.replace("_", " ")}</p>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-soft">{a.impact}</p>
                    {a.status === "pending" ? (
                      <div className="mt-2.5 flex gap-2">
                        <Btn variant={a.action === "emergency_stop" ? "danger" : "primary"} disabled={busy} onClick={() => decide(a.id, "confirm")}>Confirm</Btn>
                        <Btn variant="quiet" disabled={busy} onClick={() => decide(a.id, "reject")}>Reject</Btn>
                      </div>
                    ) : (
                      <p className="mt-2 font-utility text-[12.5px] text-dim">{a.status}{a.decided_by ? ` by ${a.decided_by.slice(0, 8)}…` : ""}</p>
                    )}
                  </div>
                ))}
                {run.error && (
                  <Notice tone={run.paused ? "review" : "deny"}>
                    {run.paused ? "Paused: the model provider's free-tier limit was reached. Continue in about a minute." : run.error}
                  </Notice>
                )}
                {run.can_continue && !working && (
                  <Btn
                    variant="quiet"
                    disabled={busy}
                    onClick={async () => {
                      setWorking(true);
                      const r = await act(async () => advance(await api<Run>(`/agent/runs/${run.id}/continue`, { method: "POST" })));
                      setWorking(false);
                      if (r) setRun(r);
                    }}
                  >
                    Continue
                  </Btn>
                )}
                {run.unverified_citations.length > 0 && (
                  <Notice tone="review">The answer cites {run.unverified_citations.length} record(s) that no tool returned in this run. Treat those as unverified.</Notice>
                )}
                <div ref={endRef} />
              </>
            )}
          </div>
          <form
            className="flex gap-2 border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label htmlFor="agent-input" className="sr-only">Message to the PALISEC Agent</label>
            <textarea
              id="agent-input"
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={!modelReady || working}
              placeholder={modelReady ? "Ask about operations, policies, findings or integrations…" : "Conversation is unavailable on this deployment"}
              className={`${inputCls} resize-none !font-sans !text-[13.5px]`}
              maxLength={4000}
            />
            <Btn type="submit" variant="primary" disabled={!modelReady || working || !text.trim()}>{working ? "Working…" : "Send"}</Btn>
          </form>
        </Panel>

        {/* ---------------------------------------------------------------- right */}
        <div className="space-y-4">
          <Panel title="Evidence" bodyClassName="p-0">
            {evidence.length === 0 ? (
              <p className="px-4 py-4 text-[12.5px] text-muted">Records the answer is based on appear here.</p>
            ) : (
              <ul className="max-h-[300px] divide-y divide-line overflow-y-auto">
                {evidence.map((e) => {
                  const href = recordHref(e.type, e.id);
                  return (
                    <li key={`${e.type}:${e.id}`} className="flex items-center justify-between gap-2 px-4 py-2 text-[12px]">
                      <span className="min-w-0">
                        <span className="label !text-[9.5px]">{e.type.replace("_", " ")}</span>
                        <span className="block truncate text-soft">{e.label ?? e.id}</span>
                      </span>
                      {href && <Link href={href} className="shrink-0 font-mono text-[11px] text-aqua hover:underline">{e.id.slice(0, 8)}</Link>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          <Panel title="Configuration" bodyClassName="p-4 space-y-3">
            {!t ? (
              <Loading what="configuration" />
            ) : (
              <>
                <div className="text-[12.5px]">
                  <p className="label mb-1.5">Model</p>
                  <Pill tone={t.model.configured ? "allow" : "muted"} className="!whitespace-normal break-all">{t.model.configured ? `${t.model.provider} · ${t.model.model}` : "not configured"}</Pill>
                </div>
                <div>
                  <p className="label mb-1.5">Autonomy level</p>
                  {can.manage(org?.role) ? (
                    <Segmented label="Autonomy level" value={String(t.config.autonomy_level)} options={LEVELS.map((l, i) => ({ value: String(i), label: l }))} onChange={setLevel} />
                  ) : (
                    <Pill tone="info">{LEVELS[t.config.autonomy_level]}</Pill>
                  )}
                  <p className="mt-2 text-[11.5px] leading-relaxed text-muted">{LEVEL_TEXT[t.config.autonomy_level]}</p>
                </div>
                {can.manage(org?.role) && (
                  <Btn variant="quiet" disabled={busy} onClick={() => act(() => api("/agent/configuration", { method: "PATCH", body: { enabled: !t.config.enabled } }), t.config.enabled ? "Agent disabled." : "Agent enabled.").then(() => tools.reload())}>
                    {t.config.enabled ? "Disable the agent" : "Enable the agent"}
                  </Btn>
                )}
                <details>
                  <summary className="cursor-pointer font-utility text-[12.5px] text-silver">Tools available to you · {t.tools.filter((x) => x.available).length}/{t.tools.length}</summary>
                  <ul className="mt-2 space-y-1">
                    {t.tools.map((x) => (
                      <li key={x.name} className="flex items-center justify-between gap-2 text-[11.5px]" title={x.description}>
                        <Mono className={x.available ? "text-soft" : "text-dim line-through"}>{x.name}</Mono>
                        <span className="font-utility text-[11.5px] text-dim">{x.risk}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
