"use client";

import { useId, useState } from "react";
import { Btn, Confirm, Field, inputCls, Mono, PageTitle, Panel, Pill } from "../kit";
import { ago, LoadError, Loading, useAction } from "./common";
import { api, can, useConsoleSession, useLive, type Role } from "./session";

interface Member {
  address: string;
  role: Role;
  created_at: string;
  last_login: string | null;
}

const ROLES: { value: Role; text: string }[] = [
  { value: "owner", text: "Owner · members, keys, everything" },
  { value: "admin", text: "Admin · agents, policies, approvals" },
  { value: "operator", text: "Operator · monitor, pause, emergency stop" },
  { value: "approver", text: "Approver · sign pending operations" },
  { value: "viewer", text: "Viewer · read only" },
];

export function LiveSettings() {
  const uid = useId();
  const { org: member, me, refresh } = useConsoleSession();
  const org = useLive<{ name: string; members: number }>("/organization");
  const members = useLive<{ members: Member[] }>("/members");
  const [name, setName] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const { run, busy, notice } = useAction();
  const own = can.own(member?.role);

  return (
    <>
      <PageTitle title="Settings" description="Your organization and who can act in it. Members sign in with their own wallet; roles are enforced by the server on every request." />
      <LoadError error={org.error ?? members.error} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <Panel title="Members">
          {!members.data ? (
            <Loading what="members" />
          ) : (
            <ul className="divide-y divide-line">
              {members.data.members.map((m) => {
                const self = m.address.toLowerCase() === me?.address.toLowerCase();
                return (
                  <li key={m.address} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                    <div className="min-w-0">
                      <Mono className="break-all text-soft">{m.address}</Mono>
                      <p className="text-[11.5px] text-muted">{self ? "You · " : ""}last sign-in {ago(m.last_login)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Pill tone={m.role === "owner" ? "info" : "muted"}>{m.role}</Pill>
                      {own && !self && (
                        <Confirm
                          label="Remove"
                          variant="quiet"
                          prompt="They lose access to this organization immediately."
                          confirmLabel="Remove member"
                          onConfirm={() => run(() => api(`/members/${m.address}`, { method: "DELETE" }), "Member removed.").then(members.reload)}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Organization" bodyClassName="p-4 space-y-3">
            {!org.data ? (
              <Loading what="organization" />
            ) : (
              <>
                <Field id={`${uid}-name`} label="Name">
                  <input id={`${uid}-name`} className={inputCls} value={name ?? org.data.name} onChange={(e) => setName(e.target.value)} readOnly={!own} maxLength={80} />
                </Field>
                {own && (
                  <Btn
                    variant="primary"
                    disabled={busy || name === null || !name.trim() || name === org.data.name}
                    onClick={() => run(() => api("/organization", { method: "PATCH", body: { name } }), "Renamed.").then(() => { setName(null); org.reload(); refresh(); })}
                  >
                    Save name
                  </Btn>
                )}
                <p className="text-[12px] text-muted">Your role: <span className="text-soft">{member?.role}</span></p>
              </>
            )}
          </Panel>

          {own && (
            <Panel title="Add or change a member" bodyClassName="p-4 space-y-3">
              <Field id={`${uid}-addr`} label="Wallet address" hint="They sign in at /login with this wallet and land in this organization.">
                <input id={`${uid}-addr`} className={inputCls} value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
              </Field>
              <Field id={`${uid}-role`} label="Role">
                <select id={`${uid}-role`} className={inputCls} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {ROLES.map((r) => <option key={r.value} value={r.value}>{r.text}</option>)}
                </select>
              </Field>
              <Btn
                variant="primary"
                disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(address)}
                onClick={() => run(() => api("/members", { method: "POST", body: { address, role } }), "Member saved.").then(() => { setAddress(""); members.reload(); })}
              >
                Save member
              </Btn>
            </Panel>
          )}
          {notice}
        </div>
      </div>
    </>
  );
}
