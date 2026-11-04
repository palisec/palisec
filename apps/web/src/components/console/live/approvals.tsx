"use client";

import { useEffect, useState } from "react";
import { formatUnits, shortHex } from "@/lib/units";
import { Codes } from "../../ui";
import { Btn, Confirm, Empty, KV, Mono, Notice, PageTitle, Panel, Segmented } from "../kit";
import { CheckList, LoadError, Loading, StatePill, usd, useAction, utc, type LiveOperation } from "./common";
import { api, can, useConsoleSession, useLive } from "./session";

interface Approval extends LiveOperation {
  typed_data: { domain: object; types: object; primaryType: string; message: Record<string, string> } | null;
}
interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function Countdown({ until }: { until: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!until) return null;
  const s = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  return <Mono className={s < 60 ? "text-deny" : "text-sand"}>{s === 0 ? "expired" : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s left`}</Mono>;
}

export function LiveApprovals() {
  const [status, setStatus] = useState<"pending" | "decided">("pending");
  const list = useLive<{ approvals: Approval[] }>(`/approvals?status=${status}`);
  const items = list.data?.approvals ?? [];
  return (
    <>
      <PageTitle
        title="Approvals"
        description="Operations a policy held for a person. Approving means signing this exact operation (request hash, account, target, value, calldata hash, policy version and expiry) with your own wallet. Nothing else is authorized by that signature."
        actions={<Btn variant="quiet" onClick={list.reload}>Refresh</Btn>}
      />
      <LoadError error={list.error} />
      <div className="mb-4">
        <Segmented label="Status" value={status} onChange={setStatus} options={[{ value: "pending", label: "Pending" }, { value: "decided", label: "Decided and expired" }]} />
      </div>
      {!list.data ? (
        <Loading what="approvals" />
      ) : items.length === 0 ? (
        <Panel><Empty title={status === "pending" ? "Nothing waiting for approval" : "No decided approvals yet"} /></Panel>
      ) : (
        <div className="space-y-4">
          {items.map((a) => <ApprovalCard key={a.operation_id} a={a} onChange={list.reload} />)}
        </div>
      )}
    </>
  );
}

function ApprovalCard({ a, onChange }: { a: Approval; onChange: () => void }) {
  const { org, me } = useConsoleSession();
  const { run, busy, notice } = useAction();
  const [raw, setRaw] = useState(false);
  const d = a.details;
  const pending = a.state === "pending_approval";

  async function approve() {
    const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (!eth || !a.typed_data || !me) return run(async () => Promise.reject(new Error("No browser wallet found. Install MetaMask or another wallet to sign.")));
    await run(async () => {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts.some((x) => x.toLowerCase() === me.address.toLowerCase()))
        throw new Error(`Switch your wallet to the signed-in account ${shortHex(me.address)} first.`);
      const signature = (await eth.request({ method: "eth_signTypedData_v4", params: [me.address, JSON.stringify(a.typed_data)] })) as string;
      return api(`/approvals/${a.operation_id}/approve`, { method: "POST", body: { signature } });
    }, "Approved. The agent can now proceed with this exact operation until the authorization expires.");
    onChange();
  }

  return (
    <Panel
      title={<span className="flex items-center gap-2">{d.agent_name} <Mono className="text-dim">{a.request_id}</Mono></span>}
      actions={<span className="flex items-center gap-2">{pending && <Countdown until={a.expires_at} />}<StatePill state={a.state} /></span>}
      bodyClassName="grid gap-4 p-4 lg:grid-cols-2"
    >
      <div className="space-y-3">
        <p className="text-[13px] leading-relaxed text-soft"><Codes text={a.message} /></p>
        <KV
          rows={[
            ["Target", <Mono key="t">{d.target}</Mono>],
            ["Method", <Mono key="m">{d.selector ?? "native transfer"}</Mono>],
            ["Value", `${formatUnits(d.value_wei, 18)} ETH`],
            ["Exposure", usd(d.exposure_usd_micros)],
            ["Fee bound", d.fee_estimate_wei ? `${formatUnits(d.fee_estimate_wei, 18)} ETH` : "unavailable"],
            ["Policy", <Mono key="p">{a.policy_id} v{a.policy_version}</Mono>],
            ["Account · chain", <Mono key="a">{shortHex(d.account)} · {d.chain_id}</Mono>],
            ["Created", utc(a.created_at)],
            ["Decided by", d.decided_by ? <Mono key="db">{shortHex(d.decided_by)} · {utc(d.decided_at)}</Mono> : "—"],
          ]}
        />
        <Btn variant="quiet" onClick={() => setRaw(!raw)}>{raw ? "Hide" : "Show"} raw calldata</Btn>
        {raw && <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-[4px] border border-line bg-ink p-2 font-mono text-[11px] text-muted">{d.data}</pre>}
      </div>
      <div className="space-y-3">
        <p className="label">Why it was held</p>
        <CheckList checks={a.checks.filter((c) => c.status !== "skipped")} />
        {pending && can.approve(org?.role) && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <Btn variant="primary" disabled={busy} onClick={approve}>Approve &amp; sign</Btn>
            <Confirm label="Reject" prompt="The operation is rejected and its reservation released. The agent sees state rejected." confirmLabel="Reject" disabled={busy} onConfirm={() => run(() => api(`/approvals/${a.operation_id}/reject`, { method: "POST", body: {} }), "Rejected.").then(onChange)} />
          </div>
        )}
        {pending && !can.approve(org?.role) && <Notice>Your role ({org?.role}) cannot approve. Owners, admins and approvers can.</Notice>}
        {notice}
      </div>
    </Panel>
  );
}
