"use client";

import { useCallback, useEffect, useState } from "react";
import { Btn, Field, inputCls, KV, Mono, Panel } from "../kit";
import { utc } from "./common";
import { api } from "./session";

/**
 * Upoch: the agent's Upoch status, read live from Upoch's public contract. Anything that cannot be
 * read shows "Unknown", never a guess. Owners and admins can set the agent's Upoch workflow.
 */
interface UpochStatus {
  workflow_id: string | null;
  available: boolean;
  recoverable: boolean | null;
  last_checkpoint_at: string | null;
  last_checkpoint_age_seconds: number | null;
  checkpoint_count: number | null;
  guardians: number | null;
  linked: boolean | null;
  active: boolean | null;
  upoch_score: number | null;
  upoch_grade?: string | null;
  upoch_url: string | null;
  read_at: string;
}

const UNKNOWN = <span className="text-dim">Unknown</span>;
const age = (s: number) => (s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`);

export function UpochPanel({ agentId, canEdit }: { agentId: string; canEdit: boolean }) {
  const [s, setS] = useState<UpochStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    api<UpochStatus>(`/agents/${agentId}/upoch`)
      .then((r) => {
        setS(r);
        setFailed(false);
        setDraft(r.workflow_id ?? "");
      })
      .catch(() => setFailed(true));
  }, [agentId]);
  useEffect(load, [load]);

  const known = s && s.available && s.workflow_id;
  const recoverable = !s || !s.available ? UNKNOWN : !s.workflow_id ? <span className="text-muted">No workflow set</span> : s.recoverable ? <span className="text-allow">Yes</span> : <span className="text-deny">No</span>;
  return (
    <Panel title="Upoch recovery" bodyClassName="p-4 space-y-3">
      <KV
        rows={[
          ["Recoverable on Upoch", failed ? UNKNOWN : recoverable],
          ["Last checkpoint (UTC)", known && s.last_checkpoint_at ? `${utc(s.last_checkpoint_at)} · ${age(s.last_checkpoint_age_seconds ?? 0)} ago` : known ? "None yet" : UNKNOWN],
          ["Checkpoints", known && s.checkpoint_count !== null ? String(s.checkpoint_count) : UNKNOWN],
          ["Guardians", known && s.guardians !== null ? String(s.guardians) : UNKNOWN],
          ["Linked to this account", known && s.linked !== null ? (s.linked ? "Yes (its owner or a guardian is an owner of this account and an established owner or admin here)" : "No") : UNKNOWN],
          ["Upoch Score", s?.upoch_score !== null && s?.upoch_score !== undefined ? `${s.upoch_score}${s.upoch_grade ? ` (${s.upoch_grade})` : ""}` : UNKNOWN],
          ["Workflow", s?.workflow_id && s.upoch_url ? <a key="u" href={s.upoch_url} target="_blank" rel="noreferrer" className="text-mist underline decoration-line-strong underline-offset-4 hover:text-aqua"><Mono>#{s.workflow_id}</Mono> on Upoch ↗</a> : "—"],
        ]}
      />
      <p className="text-[12px] text-dim">Read from Upoch&apos;s contract on Robinhood Chain{s ? ` at ${utc(s.read_at)}` : ""}. Read-only: PALISEC never signs for Upoch.</p>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <Field id={`upoch-${agentId}`} label="Upoch workflow ID" hint="Its owner or a guardian must be an owner of this account and an owner or admin of this organization.">
            <input id={`upoch-${agentId}`} className={inputCls} inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value.trim())} placeholder="e.g. 12" />
          </Field>
          <Btn
            onClick={() =>
              api(`/agents/${agentId}`, { method: "PATCH", body: { upoch_workflow_id: draft || null } })
                .then(() => {
                  setMsg("Saved.");
                  load();
                })
                .catch((e) => setMsg(e instanceof Error ? e.message : "Could not save"))
            }
          >
            Save
          </Btn>
          {msg && <span className="text-[12.5px] text-muted">{msg}</span>}
        </div>
      )}
    </Panel>
  );
}
