"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { validatePolicy } from "@palisec/policy-schema";
import { DENIAL_WINDOW_SECONDS, createCredential, recentDenials, revokeCredential, setDenialThreshold, setGlobalStop } from "@/lib/console-sim";
import { commit, randomHex, useSim, useSimNow } from "@/lib/console-store";
import { formatSimTime } from "@/lib/units";
import { CopyButton } from "../copy-button";
import { Btn, Confirm, Empty, Field, inputCls, KV, Mono, Notice, PageTitle, Panel, Pill, ScrambleText } from "./kit";

export function SecurityView() {
  const sim = useSim();
  const now = useSimNow();
  const uid = useId();
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [threshold, setThreshold] = useState(sim.breakers.denial_threshold === null ? "" : String(sim.breakers.denial_threshold));
  const [msg, setMsg] = useState<{ tone: "allow" | "deny"; text: string } | null>(null);

  const keyEvents = sim.audit.filter((e) => e.type.startsWith("credential.")).slice(-6).reverse();
  const policyValid = validatePolicy(sim.active_policy).length === 0;
  const denials = recentDenials(sim, now);

  function create(rotateFrom?: string) {
    commit((s, t) => {
      const r = createCredential(s, rotateFrom ? `${s.credentials.find((c) => c.id === rotateFrom)?.label ?? "Credential"} (rotated)` : label, t, randomHex(20));
      let state = r.state;
      if (rotateFrom) {
        const rv = revokeCredential(state, rotateFrom, t);
        if (rv.ok) state = rv.state;
      }
      setSecret({ id: state.credentials.at(-1)!.id, value: r.secret });
      setLabel("");
      return state;
    });
  }

  return (
    <>
      <PageTitle title="Keys, attestation and circuit breakers" description="Credentials for calling the API, the signing identities and enclave measurements the protected path would rely on, and the controls that stop execution." />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="API credentials">
          <div className="space-y-3 px-4 py-4">
            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); create(); }}>
              <div className="min-w-[200px] flex-1">
                <Field id={`${uid}-label`} label="New credential label">
                  <input id={`${uid}-label`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={48} placeholder="e.g. CI integration" className={inputCls} />
                </Field>
              </div>
              <Btn type="submit" variant="primary">Create credential</Btn>
            </form>
            {secret && (
              <div role="status" className="c-burst animate-[c-pop_.4s_var(--ease-out-quint)] rounded-[6px] border border-citrine/40 bg-citrine/[0.04] p-3">
                <p className="text-[13px] text-soft">Copy this secret now. It is shown once and only a hint is kept. It is a simulation value and authenticates nothing.</p>
                <div className="mt-2 flex items-center gap-2">
                  <ScrambleText key={secret.id} text={secret.value} className="min-w-0 flex-1 break-all rounded-[4px] bg-ink px-2 py-1.5 font-mono text-[11.5px] text-citrine" />
                  <CopyButton text={secret.value} label="Copy new secret" />
                </div>
                <Btn variant="quiet" className="mt-2" onClick={() => setSecret(null)}>I stored it · hide</Btn>
              </div>
            )}
          </div>
          {sim.credentials.length === 0 ? (
            <Empty title="No credentials." />
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {[...sim.credentials].reverse().map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-[13.5px] text-bone">{c.label}</span>
                    <Mono className="text-dim">{c.id} · {c.hint} · created {formatSimTime(c.created_at).slice(5, 16)}</Mono>
                  </span>
                  {c.status === "active" ? (
                    <span className="flex flex-wrap gap-2">
                      <Btn variant="quiet" onClick={() => create(c.id)}>Rotate</Btn>
                      <Confirm variant="danger" label="Revoke" prompt={<>Revoke <strong className="text-bone">{c.label}</strong>? Requests using it fail with RW_AUTH_001 immediately.</>} confirmLabel="Revoke credential" onConfirm={() => commit((s, t) => { const r = revokeCredential(s, c.id, t); return r.ok ? r.state : s; })} />
                    </span>
                  ) : (
                    <Pill tone="muted">revoked {c.revoked_at ? formatSimTime(c.revoked_at).slice(5, 16) : ""}</Pill>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Signing identities and attestation">
          <div className="px-4 py-3">
            <KV
              rows={[
                ["Authorized signer keys", <span key="s" className="text-muted">None registered. Keys would be generated inside the enclave and registered with the smart account.</span>],
                ["Current measurements", <Mono key="c" className="text-dim">PCR0 · PCR1 · PCR2 — unavailable</Mono>],
                ["Previous measurements", <Mono key="p" className="text-dim">none</Mono>],
                ["Attestation status", <Pill key="a" tone="review">◆ Not verified · no enclave deployed</Pill>],
                ["Verified at", <Mono key="v" className="text-dim">never</Mono>],
                ["Deployment version", <Mono key="d" className="text-dim">no enclave image published</Mono>],
              ]}
            />
            <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
              Scope and freshness: a public key or PCR value is not proof that a correctly configured signing service is live. When deployed, each verification result shows
              what it covers and when it was taken. <Link href="/attestation" className="text-soft underline decoration-line-strong underline-offset-4 hover:text-citrine">How attestation is verified</Link>.
            </p>
          </div>
          <div className="border-t border-line">
            <p className="label px-4 pt-3 !text-[10px]">Key registration and revocation events</p>
            {keyEvents.length === 0 ? (
              <Empty title="No key events." />
            ) : (
              <ul className="divide-y divide-line">
                {keyEvents.map((e) => (
                  <li key={e.id}>
                    <Link href={`/console/audit#${e.id}`} className="flex justify-between gap-3 px-4 py-2 text-[12.5px] text-soft hover:bg-raised/50">
                      <span className="min-w-0 truncate">{e.summary}</span>
                      <Mono className="text-dim">{formatSimTime(e.at).slice(5, 16)}</Mono>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Circuit breakers" id="breakers" className="mt-4 scroll-mt-16">
        <div className="grid gap-px bg-line lg:grid-cols-2">
          <div className="space-y-3 bg-surface px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[14px] font-semibold text-bone">Disable new authorizations globally</p>
              <Pill key={String(sim.breakers.global_stop)} tone={sim.breakers.global_stop ? "deny" : "allow"} className={`animate-[c-pop_.4s_var(--ease-out-quint)] ${sim.breakers.global_stop ? "c-urgent" : ""}`}>{sim.breakers.global_stop ? "■ Engaged" : "● Released"}</Pill>
            </div>
            <p className="text-[12.5px] leading-relaxed text-muted">Every new protected execution is denied with RW_PAUSED_001 and pending approvals cannot be approved.</p>
            {!sim.breakers.global_stop ? (
              <Confirm label="Engage global stop" prompt="Deny every new operation for every agent until the stop is released?" confirmLabel="Engage global stop" onConfirm={() => commit((s, t) => setGlobalStop(s, true, t))} />
            ) : (
              <Confirm
                variant="primary"
                label="Release after health checks"
                prompt={
                  <div>
                    <p>Resume only after these checks pass:</p>
                    <ul className="mt-2 space-y-1 font-mono text-[11.5px]">
                      <li className={policyValid ? "text-citrine" : "text-deny"}>{policyValid ? "✓" : "■"} active policy v{sim.active_policy.version} passes schema validation</li>
                      <li className="text-citrine">✓ state store (this browser) readable</li>
                      <li className="text-stone">○ signing service · not deployed · nothing to check</li>
                      <li className={denials === 0 ? "text-citrine" : "text-sand"}>{denials === 0 ? "✓" : "◆"} {denials} denials in the last hour</li>
                    </ul>
                  </div>
                }
                confirmLabel="Release global stop"
                disabled={!policyValid}
                onConfirm={() => commit((s, t) => setGlobalStop(s, false, t))}
              />
            )}
          </div>

          <div className="space-y-3 bg-surface px-4 py-4">
            <p className="text-[14px] font-semibold text-bone">Denial-rate trigger</p>
            <p className="text-[12.5px] leading-relaxed text-muted">
              Engage the global stop automatically when denials within {DENIAL_WINDOW_SECONDS / 60} minutes reach a threshold. Currently {denials} in the window;{" "}
              {sim.breakers.denial_threshold === null ? "trigger off." : `trigger at ${sim.breakers.denial_threshold}.`}
            </p>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const t = threshold.trim() === "" ? null : Number(threshold);
                if (t !== null && (!Number.isInteger(t) || t < 1 || t > 1000)) return setMsg({ tone: "deny", text: "Threshold must be a whole number from 1 to 1000, or empty to disable." });
                commit((s, n) => setDenialThreshold(s, t, n));
                setMsg({ tone: "allow", text: t === null ? "Denial-rate trigger disabled." : `Trigger armed at ${t} denials per hour.` });
              }}
            >
              <div className="w-40">
                <Field id={`${uid}-th`} label="Denials per hour">
                  <input id={`${uid}-th`} inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="off" className={inputCls} />
                </Field>
              </div>
              <Btn type="submit" variant="ghost">Save trigger</Btn>
            </form>
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          </div>

          <div className="space-y-2 bg-surface px-4 py-4">
            <p className="text-[14px] font-semibold text-bone">Pause one agent</p>
            <ul className="space-y-1 text-[13px]">
              {sim.agents.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3">
                  <span className="text-soft">{a.name}</span>
                  <Pill tone={a.status === "active" ? "allow" : a.status === "paused" ? "review" : "deny"}>{a.status}</Pill>
                </li>
              ))}
            </ul>
            <Link href="/console/agents" className="inline-block font-utility text-[10.5px] uppercase tracking-[0.06em] text-stone hover:text-citrine">Pause or resume in Agents →</Link>
          </div>

          <div className="space-y-2 bg-surface px-4 py-4">
            <p className="text-[14px] font-semibold text-bone">Pause a smart account · revoke a signing identity</p>
            <div className="flex flex-wrap gap-2">
              <Btn variant="danger" disabled title="Requires the deployed validation module">Pause smart account</Btn>
              <Btn variant="danger" disabled title="No signing identity is registered">Revoke signing identity</Btn>
            </div>
            <p className="text-[12.5px] leading-relaxed text-muted">
              Both need an on-chain transaction through the account&apos;s validation module, which is not deployed. In production these use an independent control path, not the
              same API key or process that may be compromised; the agent and global stops above act immediately at the policy engine.
            </p>
          </div>
        </div>
      </Panel>
    </>
  );
}
