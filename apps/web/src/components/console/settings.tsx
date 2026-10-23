"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ROLES, addMember, changeRole, renameOrg, type Role } from "@/lib/console-sim";
import { commit, resetWorkspace, useSim } from "@/lib/console-store";
import { formatSimTime } from "@/lib/units";
import { Btn, Confirm, Field, inputCls, KV, Mono, Notice, PageTitle, Panel, Pill } from "./kit";

const selectCls = "rounded-[4px] border border-graphite bg-ink px-2 py-1.5 text-[12.5px] text-fg focus:border-citrine";

export function SettingsView() {
  const sim = useSim();
  const uid = useId();
  const [name, setName] = useState("");
  const [identity, setIdentity] = useState("");
  const [role, setRole] = useState<Role>("Viewer");
  const [msg, setMsg] = useState<{ tone: "allow" | "deny"; text: string } | null>(null);

  const run = (fn: Parameters<typeof commit>[0]) => commit(fn);
  const result = (ok: boolean, text: string) => setMsg({ tone: ok ? "allow" : "deny", text });

  return (
    <>
      <PageTitle title="Organization and access" description="Members, roles and sign-in. In production, roles are enforced by the API on every request; the console is never the only enforcement layer." />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
        <div className="min-w-0 space-y-4">
          <Panel title="Members">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead className="text-left">
                  <tr>{["Member", "Identity", "Role", "Added"].map((h) => <th key={h} className="label border-b border-line-strong px-4 py-2 !text-[10px] font-normal">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {sim.members.map((m) => (
                    <tr key={m.id} className="border-b border-line">
                      <td className="px-4 py-2.5 text-bone">{m.name}</td>
                      <td className="px-4 py-2.5"><Mono className="text-muted">{m.identity}</Mono></td>
                      <td className="px-4 py-2.5">
                        {m.role === "Owner" ? (
                          <Pill tone="allow">Owner</Pill>
                        ) : (
                          <select
                            aria-label={`Role for ${m.name}`}
                            value={m.role}
                            onChange={(e) =>
                              run((s, t) => {
                                const r = changeRole(s, m.id, e.target.value as Role, t);
                                result(r.ok, r.ok ? `${m.name} is now ${e.target.value}.` : r.error);
                                return r.ok ? r.state : s;
                              })
                            }
                            className={selectCls}
                          >
                            {ROLES.map((r) => <option key={r.role} value={r.role}>{r.role}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11.5px] text-dim">{formatSimTime(m.added_at).slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form
              className="grid gap-3 border-t border-line px-4 py-4 sm:grid-cols-[1fr_1.4fr_auto_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                run((s, t) => {
                  const r = addMember(s, name, identity, role, t);
                  result(r.ok, r.ok ? `${name.trim()} added as ${role}. In production they would accept an invitation first.` : r.error);
                  if (r.ok) { setName(""); setIdentity(""); }
                  return r.ok ? r.state : s;
                });
              }}
            >
              <Field id={`${uid}-n`} label="Name"><input id={`${uid}-n`} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
              <Field id={`${uid}-i`} label="Wallet address or email"><input id={`${uid}-i`} value={identity} onChange={(e) => setIdentity(e.target.value)} spellCheck={false} className={inputCls} /></Field>
              <Field id={`${uid}-r`} label="Role">
                <select id={`${uid}-r`} value={role} onChange={(e) => setRole(e.target.value as Role)} className={selectCls}>
                  {ROLES.filter((r) => r.role !== "Owner").map((r) => <option key={r.role} value={r.role}>{r.role}</option>)}
                </select>
              </Field>
              <Btn type="submit" variant="primary">Add member</Btn>
            </form>
            {msg && <div className="px-4 pb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
          </Panel>

          <Panel title="Roles">
            <table className="w-full text-[13px]">
              <tbody>
                {ROLES.map((r) => (
                  <tr key={r.role} className="border-b border-line last:border-b-0">
                    <th scope="row" className="w-36 px-4 py-2.5 text-left font-medium text-bone">{r.role}</th>
                    <td className="px-4 py-2.5 text-muted">{r.permissions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line px-4 py-3 text-[12.5px] leading-relaxed text-muted">
              Policy activation, key rotation, signer registration, ownership changes and emergency-stop recovery each require an additional confirmation.
            </p>
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel title="Organization">
            <OrgForm key={sim.org.name} name={sim.org.name} orgId={sim.org.id} />
          </Panel>

          <Panel title="Sign-in and sessions">
            <ul className="divide-y divide-line text-[13px]">
              {[
                ["Wallet sign-in", "Signed challenge with nonce, domain and expiry (SIWE)"],
                ["GitHub OAuth", "Optional identity provider"],
                ["Sessions", "Secure HttpOnly cookies with CSRF protection and revocation"],
                ["Multi-factor", "Optional, for sensitive administrative actions"],
              ].map(([k, v]) => (
                <li key={k} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <span><span className="block text-soft">{k}</span><span className="block text-[12px] text-muted">{v}</span></span>
                  <Pill tone="muted">Not deployed</Pill>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-4 py-3 text-[12.5px] text-muted">
              No sessions exist: this workspace runs without an account, so signing out does not apply. The{" "}
              <Link href="/login" className="text-soft underline decoration-line-strong underline-offset-4 hover:text-citrine">sign-in page</Link> shows the methods that will be offered.
            </p>
          </Panel>

          <Panel title="Workspace data">
            <div className="space-y-3 px-4 py-4">
              <p className="text-[12.5px] leading-relaxed text-muted">All simulation data lives in this browser&apos;s local storage and is never uploaded. Resetting restores the seeded example data.</p>
              <Confirm variant="quiet" label="Reset simulation workspace" prompt="Discard every change made in this browser and restore the seeded example data?" confirmLabel="Reset workspace" onConfirm={() => { resetWorkspace(); result(true, "Workspace reset to the seeded example data."); }} />
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

/** Keyed on the saved name, so it always starts from what the store holds. */
function OrgForm({ name, orgId }: { name: string; orgId: string }) {
  const uid = useId();
  const [value, setValue] = useState(name);
  const [msg, setMsg] = useState<{ tone: "allow" | "deny"; text: string } | null>(null);
  const clean = value.trim();
  const problem = clean.length < 2 ? "Enter at least 2 characters." : clean.length > 64 ? "Use at most 64 characters." : null;
  return (
    <form
      className="space-y-3 px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (problem) return setMsg({ tone: "deny", text: problem });
        commit((s, t) => {
          const r = renameOrg(s, value, t);
          setMsg(r.ok ? { tone: "allow", text: `Organization renamed to ${clean}.` } : { tone: "deny", text: r.error });
          return r.ok ? r.state : s;
        });
      }}
    >
      <Field id={`${uid}-org`} label="Organization name" hint={problem && value !== name ? problem : undefined}>
        <input id={`${uid}-org`} value={value} onChange={(e) => setValue(e.target.value)} maxLength={64} aria-invalid={Boolean(problem)} className={inputCls} />
      </Field>
      <KV rows={[["Organization ID", <Mono key="o">{orgId}</Mono>], ["Environment", <Pill key="e" tone="info">◆ Simulation</Pill>], ["Tenancy", "Isolated per organization, enforced server-side in production"]]} />
      <Btn type="submit" variant="ghost" disabled={clean === name || Boolean(problem)} title={problem ?? (clean === name ? "No change to save" : undefined)}>Save name</Btn>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </form>
  );
}
