"use client";

import Link from "next/link";
import { Confirm, KV, Notice, PageTitle, Panel, Pill } from "../kit";
import { LoadError, Loading, useAction } from "./common";
import { api, can, useConsoleSession, useLive } from "./session";

interface Org {
  name: string;
  emergency_stop: boolean;
}

/**
 * Circuit breakers and the honest state of the signing path. Nothing here claims a signer, enclave or
 * on-chain module that is not deployed.
 */
export function LiveSecurity() {
  const { org: member, refresh } = useConsoleSession();
  const org = useLive<Org>("/organization");
  const { run, busy, notice } = useAction();
  const o = org.data;
  const set = (active: boolean) =>
    run(() => api("/organization/emergency-stop", { method: "POST", body: { active, confirm: true } }), active ? "Emergency stop engaged." : "Emergency stop lifted.").then(() => {
      org.reload();
      refresh();
    });

  return (
    <>
      <PageTitle title="Security" description="Circuit breakers for your organization, and what the protected execution path enforces today." />
      <LoadError error={org.error} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Panel title="Emergency stop" id="breakers" actions={o ? <Pill tone={o.emergency_stop ? "deny" : "allow"}>{o.emergency_stop ? "■ Engaged" : "● Off"}</Pill> : null} bodyClassName="p-4 space-y-3">
          {!o ? (
            <Loading what="status" />
          ) : (
            <>
              <p className="text-[13px] leading-relaxed text-soft">
                While engaged, every new operation in this organization is denied with <code className="font-mono text-[0.9em]">PS_PAUSED_001</code>, and pending approvals cannot be approved. It is enforced by the
                same database row every evaluation reads, so it applies to the next request. Operators can engage it; only an owner can lift it.
              </p>
              {!o.emergency_stop && can.operate(member?.role) && (
                <Confirm label="Engage emergency stop" prompt="All agents in this organization are denied immediately. Authorizations already issued are not recalled." confirmLabel="Engage stop" disabled={busy} onConfirm={() => set(true)} />
              )}
              {o.emergency_stop && can.own(member?.role) && (
                <Confirm variant="primary" label="Lift emergency stop" prompt="Agents can be authorized again under their policies." confirmLabel="Lift stop" disabled={busy} onConfirm={() => set(false)} />
              )}
              {o.emergency_stop && !can.own(member?.role) && <Notice>Only an owner can lift the stop.</Notice>}
              {notice}
            </>
          )}
        </Panel>

        <Panel title="What is enforced today" bodyClassName="p-4">
          <KV
            rows={[
              ["Authorization decisions", <Pill key="a" tone="allow">● Live</Pill>],
              ["Budget reservations and replay", <Pill key="b" tone="allow">● Live · atomic in Postgres</Pill>],
              ["Human approvals", <Pill key="h" tone="allow">● Live · EIP-712 signatures</Pill>],
              ["Protected signing (TEE)", <Pill key="s" tone="muted">○ Not deployed</Pill>],
              ["Bundler submission", <Pill key="u" tone="muted">○ Not deployed</Pill>],
              ["On-chain validation module", <Pill key="v" tone="muted">○ Not deployed</Pill>],
            ]}
          />
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
            Until the account module ships, Palisec is a gate your agent must call: it records and limits authorizations, but a key that bypasses it can still send transactions. See{" "}
            <Link href="/security" className="text-soft underline underline-offset-4 hover:text-aqua">security</Link> for the threat model.
          </p>
        </Panel>

        <Panel title="Circuit breakers" bodyClassName="p-4">
          <KV
            rows={[
              ["Disable new authorizations globally", <span key="g" className="text-soft">Emergency stop, above · enforced on the next request</span>],
              ["Pause one agent", <Link key="a" href="/console/agents" className="text-soft underline underline-offset-4 hover:text-aqua">Agents → Pause · enforced on the next request</Link>],
              ["Revoke one API key", <Link key="k" href="/console/agents" className="text-soft underline underline-offset-4 hover:text-aqua">Agents → API keys · immediate</Link>],
              ["Disable a policy", <Link key="p" href="/console/policies" className="text-soft underline underline-offset-4 hover:text-aqua">Policies → Disable · enforced on the next request</Link>],
              ["Pause one smart account", <Pill key="s" tone="muted">○ needs the on-chain module</Pill>],
              ["Revoke a signing identity", <Pill key="r" tone="muted">○ needs protected signing</Pill>],
            ]}
          />
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
            Every control here is a row in the authorization database that each evaluation reads. None of them can recall a transaction an
            agent already sent with an earlier ALLOW.
          </p>
        </Panel>

        <Panel title="Signing keys and attestation" bodyClassName="p-4">
          <p className="text-[13px] leading-relaxed text-soft">
            No signer public keys are registered and there are no enclave measurements to verify, because protected signing (AWS Nitro) is not
            deployed. When it is, this panel shows the authorized signer keys, current and previous measurements, and the scope and time of
            each attestation check. A key or PCR value alone is not proof of a live, correctly configured signer.
          </p>
        </Panel>

        <Panel title="API keys" bodyClassName="p-4">
          <p className="text-[13px] leading-relaxed text-soft">
            Keys belong to one agent and are shown once at creation. Only a SHA-256 hash is stored, so a database leak does not reveal usable keys. Create, review and revoke them on the{" "}
            <Link href="/console/agents" className="text-mist underline underline-offset-4 hover:text-aqua">Agents</Link> page.
          </p>
        </Panel>
      </div>
    </>
  );
}
