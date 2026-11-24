"use client";

import { EXAMPLE_POLICY, validatePolicy, type CheckResult, type ValidationError } from "@palisec/policy-schema";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { networkLabel } from "@/lib/networks";
import { formatUnits, parseUnits } from "@/lib/units";
import { CopyButton } from "../../copy-button";
import { CloseIcon } from "../../icons";
import { Btn, Confirm, Empty, Field, inputCls, KV, Mono, Notice, PageTitle, Panel, Pill, IconBtn } from "../kit";
import { CheckList, DecisionPill, LoadError, Loading, thCls, usd, useAction, utc } from "./common";
import { api, can, useConsoleSession, useLive } from "./session";

interface PolicyRow {
  id: string;
  policy_key: string;
  name: string;
  status: "draft" | "active" | "disabled";
  active_version: number | null;
  draft_valid: boolean | null;
  draft_updated_at: string | null;
  activated_at: string | null;
  agents: number;
}
interface PolicyDetail {
  id: string;
  policy_key: string;
  name: string;
  status: string;
  active_version: number | null;
  draft: Record<string, unknown> | null;
  draft_hash: string | null;
  draft_errors: ValidationError[];
  draft_updated_at: string | null;
  draft_updated_by: string | null;
  active_document: Record<string, unknown> | null;
  versions: { version: number; document_hash: string; activated_at: string; activated_by: string | null }[];
}

const STATUS_TONE = { draft: "muted", active: "allow", disabled: "deny" } as const;

export function LivePolicies() {
  const { org } = useConsoleSession();
  const list = useLive<{ policies: PolicyRow[] }>("/policies");
  const [selected, setSelected] = useState<string | null>(null);
  const policies = list.data?.policies ?? [];
  const current = selected ?? policies[0]?.id ?? null;

  return (
    <>
      <PageTitle
        title="Policies"
        description="Edit a draft, validate it against the policy schema (1.0 or 1.1), review the difference, then activate it as an immutable version. Agents are evaluated against the active version only; a missing or disabled policy denies with PS_POLICY_001."
      />
      <LoadError error={list.error} />
      <div className="space-y-4">
        <Panel title={`Policies · ${policies.length}`}>
          {!list.data ? (
            <Loading what="policies" />
          ) : policies.length === 0 ? (
            <Empty title="No policies yet">Create one below. It starts as a conservative draft: tiny limits, nothing allowlisted, unknown methods sent to a human.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-[13px]">
                <thead className="text-left">
                  <tr>{["Policy", "Status", "Active version", "Draft", "Agents"].map((h) => <th key={h} className={thCls}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {policies.map((p) => (
                    <tr key={p.id} className={`border-b border-line transition-colors ${p.id === current ? "bg-raised/70" : "hover:bg-raised/40"}`}>
                      <td className="px-4 py-2.5">
                        <button type="button" onClick={() => setSelected(p.id)} aria-pressed={p.id === current} className="text-left">
                          <span className="block text-mist underline-offset-4 hover:underline">{p.name}</span>
                          <Mono className="text-dim">{p.policy_key}</Mono>
                        </button>
                      </td>
                      <td className="px-4 py-2.5"><Pill tone={STATUS_TONE[p.status]}>{p.status}</Pill></td>
                      <td className="px-4 py-2.5 font-mono text-soft">{p.active_version ? `v${p.active_version}` : "—"}</td>
                      <td className="px-4 py-2.5 text-muted">{p.draft_valid === null ? "—" : p.draft_valid ? "valid" : <span className="text-deny">invalid</span>}</td>
                      <td className="px-4 py-2.5 font-mono text-soft">{p.agents}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        {can.manage(org?.role) && <CreatePolicy onCreated={(id) => { setSelected(id); list.reload(); }} />}
        {current && <PolicyEditor key={current} id={current} onChange={list.reload} />}
      </div>
    </>
  );
}

function CreatePolicy({ onCreated }: { onCreated: (id: string) => void }) {
  const uid = useId();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [account, setAccount] = useState("");
  const { run, busy, notice } = useAction();
  const { network } = useConsoleSession();
  const derivedKey = key || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 64);
  return (
    <Panel title="Create a policy" bodyClassName="grid gap-3 p-4 md:grid-cols-3">
      <Field id={`${uid}-n`} label="Name">
        <input id={`${uid}-n`} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Treasury bot limits" maxLength={80} />
      </Field>
      <Field id={`${uid}-k`} label="Policy ID" hint="a-z, 0-9 and _; cannot change later.">
        <input id={`${uid}-k`} className={inputCls} value={derivedKey} onChange={(e) => setKey(e.target.value)} placeholder="treasury_bot" spellCheck={false} />
      </Field>
      <Field id={`${uid}-a`} label={`Smart account (${networkLabel(network, "short")})`}>
        <input id={`${uid}-a`} className={inputCls} value={account} onChange={(e) => setAccount(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
      </Field>
      <div className="md:col-span-3">
        <Btn
          variant="primary"
          disabled={busy || !name.trim() || !derivedKey || !account}
          onClick={async () => {
            const r = await run(() => api<{ id: string }>("/policies", { method: "POST", body: { name, policy_key: derivedKey, chain_id: network, account } }), "Draft created. Edit it below, then activate.");
            if (r) {
              setName("");
              setKey("");
              setAccount("");
              onCreated(r.id);
            }
          }}
        >
          Create draft
        </Btn>
        {notice && <div className="mt-3">{notice}</div>}
      </div>
    </Panel>
  );
}

/** Paths whose values differ between two documents, for a compact review before activation. */
function diff(a: unknown, b: unknown, path = "$"): { path: string; from: string; to: string }[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObj = (v: unknown) => v && typeof v === "object" && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    return [...keys].flatMap((k) => diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`));
  }
  const show = (v: unknown) => (v === undefined ? "∅" : JSON.stringify(v));
  return [{ path, from: show(a), to: show(b) }];
}

const IGNORED_IN_DIFF = new Set(["$.version", "$.status"]);

/** Postgres stores JSON keys in its own order; show them in the schema's order instead. */
function ordered(value: unknown, template: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => ordered(v, Array.isArray(template) ? template[0] : undefined));
  if (!value || typeof value !== "object") return value;
  const t = (template && typeof template === "object" ? template : {}) as Record<string, unknown>;
  const v = value as Record<string, unknown>;
  const keys = [...Object.keys(t).filter((k) => k in v), ...Object.keys(v).filter((k) => !(k in t))];
  return Object.fromEntries(keys.map((k) => [k, ordered(v[k], t[k])]));
}
const pretty = (doc: unknown) => JSON.stringify(ordered(doc, EXAMPLE_POLICY), null, 2);

function PolicyEditor({ id, onChange }: { id: string; onChange: () => void }) {
  const uid = useId();
  const { org } = useConsoleSession();
  const detail = useLive<PolicyDetail>(`/policies/${id}`);
  const p = detail.data;
  const [text, setText] = useState<string | null>(null);
  const { run, busy, notice } = useAction();
  const manage = can.manage(org?.role);

  const savedText = p?.draft ? pretty(p.draft) : "";
  const value = text ?? savedText;
  const dirty = text !== null && text !== savedText;
  const parsed = useMemo(() => {
    try {
      return { doc: JSON.parse(value) as Record<string, unknown>, error: null };
    } catch (e) {
      return { doc: null, error: e instanceof Error ? e.message : "Invalid JSON" };
    }
  }, [value]);
  const errors: ValidationError[] = useMemo(() => {
    if (!parsed.doc) return [{ path: "$", message: parsed.error ?? "Invalid JSON" }];
    const errs = validatePolicy({ ...parsed.doc, version: 1, status: "active" });
    if (p && parsed.doc.policy_id !== p.policy_key) errs.push({ path: "$.policy_id", message: `must stay "${p.policy_key}"` });
    return errs;
  }, [parsed, p]);
  const changes = useMemo(() => (parsed.doc ? diff(p?.active_document ?? {}, parsed.doc).filter((c) => !IGNORED_IN_DIFF.has(c.path)) : []), [parsed, p]);

  if (detail.error) return <LoadError error={detail.error} />;
  if (!p) return <Panel title="Policy"><Loading what="policy" /></Panel>;

  const edit = (fn: (d: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!parsed.doc) return;
    const d = structuredClone(parsed.doc);
    fn(d);
    setText(pretty(d));
  };
  const after = () => {
    setText(null);
    detail.reload();
    onChange();
  };

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(340px,460px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <p className="label">Configuration</p>
        {manage && parsed.doc && <QuickEdits doc={parsed.doc} edit={edit} />}
        {parsed.doc && errors.length === 0 && <TestPanel doc={parsed.doc} />}
        <Panel title={p.active_version ? `Changes from v${p.active_version}` : "Changes (no active version)"} bodyClassName="p-4 space-y-3">
          {changes.length === 0 ? (
            <p className="text-[13px] text-muted">The draft matches the active version.</p>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-auto text-[12px]">
              {changes.map((c) => (
                <li key={c.path}>
                  <Mono className="text-soft">{c.path}</Mono>
                  <div className="font-mono text-[11.5px]"><span className="text-deny">− {c.from.slice(0, 120)}</span></div>
                  <div className="font-mono text-[11.5px]"><span className="text-aqua">+ {c.to.slice(0, 120)}</span></div>
                </li>
              ))}
            </ul>
          )}
          {manage && (
            <>
              {dirty && <Notice>Save the draft before activating. Activation is bound to the saved draft&apos;s hash.</Notice>}
              <Confirm
                variant="primary"
                label={`Activate as v${(p.active_version ?? 0) + 1}`}
                disabled={busy || dirty || errors.length > 0 || !p.draft_hash || changes.length === 0}
                disabledReason="Save a valid draft that differs from the active version"
                prompt={`Agents bound to ${p.policy_key} will be evaluated against this version immediately. Pending approvals made under the old version can no longer be approved.`}
                confirmLabel="Activate"
                onConfirm={() => run(() => api(`/policies/${id}/activate`, { method: "POST", body: { confirm: true, draft_hash: p.draft_hash } }), "Activated. The version and its hash are in the audit trail.").then(after)}
              />
              {p.status === "active" && (
                <Confirm
                  label="Disable policy"
                  prompt="Every agent bound to this policy is denied with PS_POLICY_001 until a version is activated again."
                  confirmLabel="Disable"
                  onConfirm={() => run(() => api(`/policies/${id}/disable`, { method: "POST", body: { confirm: true } }), "Policy disabled.").then(after)}
                />
              )}
            </>
          )}
        </Panel>

      </div>

      <div className="min-w-0 space-y-4">
        <p className="label">Generated policy</p>
        <Panel
          title={`${p.name} · draft`}
          actions={<Pill tone={errors.length ? "deny" : "allow"}>{errors.length ? `${errors.length} error${errors.length > 1 ? "s" : ""}` : "valid"}</Pill>}
          bodyClassName="p-4 space-y-3"
        >
          <label htmlFor={`${uid}-json`} className="sr-only">Policy JSON</label>
          <textarea
            id={`${uid}-json`}
            value={value}
            onChange={(e) => setText(e.target.value)}
            readOnly={!manage}
            spellCheck={false}
            rows={28}
            className={`${inputCls} min-h-[28rem] resize-y leading-relaxed`}
          />
          {errors.length > 0 && (
            <ul className="space-y-1 text-[12px]">
              {errors.slice(0, 8).map((e, i) => (
                <li key={i} className="text-deny"><Mono>{e.path}</Mono> <span className="text-soft">{e.message}</span></li>
              ))}
            </ul>
          )}
          {manage && (
            <div className="flex flex-wrap items-center gap-2">
              <Btn variant="primary" disabled={busy || !dirty || !parsed.doc} onClick={() => run(() => api(`/policies/${id}`, { method: "PUT", body: { document: parsed.doc } }), "Draft saved.").then(after)}>
                Save draft
              </Btn>
              <Btn variant="quiet" disabled={!dirty} onClick={() => setText(null)}>Discard changes</Btn>
              <CopyButton text={value} label="Copy JSON" />
            </div>
          )}
          {notice}
        </Panel>
        <Panel title="Versions" bodyClassName="p-4">
          {p.versions.length === 0 ? (
            <p className="text-[13px] text-muted">Not activated yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {p.versions.map((v) => (
                <li key={v.version} className="py-2 text-[12.5px]">
                  <p className="text-soft">
                    v{v.version} {v.version === p.active_version && p.status === "active" && <Pill tone="allow" className="ml-1">active</Pill>}
                  </p>
                  <p className="text-[11.5px] text-muted">{utc(v.activated_at)}{v.activated_by ? ` · ${v.activated_by.slice(0, 10)}…` : ""}</p>
                  <Mono className="block truncate text-[11px] text-dim">sha256 {v.document_hash}</Mono>
                </li>
              ))}
            </ul>
          )}
          {p.versions.length > 0 && <VersionCompare policyId={p.id} versions={p.versions.map((v) => v.version)} hasDraft={Boolean(p.draft)} />}
          <KV className="mt-3" rows={[["Draft saved", utc(p.draft_updated_at)]]} />
          <p className="mt-3 text-[12px] text-muted">
            Field reference: <Link href="/docs/policies" className="text-soft underline underline-offset-4 hover:text-aqua">policy schema 1.0</Link>.
          </p>
        </Panel>
      </div>
    </div>
  );
}

/** Rule builder (spec §11.4): edits in human units, written into the JSON so the editor stays the single source. */
function QuickEdits({ doc, edit }: { doc: Record<string, any>; edit: (fn: (d: Record<string, any>) => void) => void }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const uid = useId();
  const [contract, setContract] = useState("");
  const [selectors, setSelectors] = useState("0xa9059cbb");
  const [deny, setDeny] = useState("");
  const [requireCode, setRequireCode] = useState(true);
  const unitField = (label: string, decimals: number, current: string | undefined, set: (d: Record<string, any>, v: string) => void, hint?: string) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
    <Field id={`${uid}-${label}`} label={label} hint={hint}>
      <input
        id={`${uid}-${label}`}
        className={inputCls}
        inputMode="decimal"
        defaultValue={current ? formatUnits(current, decimals) : ""}
        key={current}
        onBlur={(e) => {
          const v = parseUnits(e.target.value, decimals);
          if (v !== null) edit((d) => set(d, v.toString()));
        }}
      />
    </Field>
  );
  const intField = (label: string, current: number | undefined, set: (d: Record<string, any>, v: number) => void, hint?: string) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
    <Field id={`${uid}-${label}`} label={label} hint={hint}>
      <input
        id={`${uid}-${label}`}
        className={inputCls}
        inputMode="numeric"
        defaultValue={current ?? ""}
        key={String(current)}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (Number.isInteger(v) && v >= 0) edit((d) => set(d, v));
        }}
      />
    </Field>
  );
  const allow = (doc.contracts?.allowlist ?? []) as { address: string; selectors: string[]; require_verified_code: boolean }[];
  const denylist = (doc.contracts?.denylist ?? []) as string[];
  const section = "space-y-3 border-t border-line pt-3";
  return (
    <Panel title="Rule builder" bodyClassName="grid gap-3 p-4">
      <p className="label">Transaction limits</p>
      {unitField("Max value per transaction (ETH)", 18, doc.limits?.max_transaction_value_wei, (d, v) => (d.limits.max_transaction_value_wei = v))}
      {unitField("Max gas cost (ETH)", 18, doc.limits?.max_gas_cost_wei, (d, v) => (d.limits.max_gas_cost_wei = v), "Bound = gas limit × current gas price. Unknown fees are denied, never treated as zero.")}
      <div className={section}>
        <p className="label">Budget window · rolling hour</p>
        {unitField("Hourly budget (USD)", 6, doc.limits?.hourly_budget_usd_micros, (d, v) => (d.limits.hourly_budget_usd_micros = v), "Counts ETH value plus fee, and tokens too when token_spend is on (in the JSON). Shared by every agent on this policy.")}
        {intField("Max pending operations", doc.limits?.max_pending_operations, (d, v) => (d.limits.max_pending_operations = Math.min(v, 1000)))}
        {intField("Max price age (seconds)", doc.limits?.max_price_age_seconds, (d, v) => (d.limits.max_price_age_seconds = Math.min(Math.max(v, 1), 3600)), "Older ETH/USD prices fail closed. 30 or more is recommended.")}
      </div>
      <div className={section}>
        <p className="label">Cooldowns · loop detection</p>
        {intField("Same calldata (seconds)", doc.cooldowns?.identical_calldata_seconds, (d, v) => (d.cooldowns.identical_calldata_seconds = Math.min(v, 86400)))}
        {intField("Same intent (seconds)", doc.cooldowns?.identical_intent_seconds, (d, v) => (d.cooldowns.identical_intent_seconds = Math.min(v, 86400)), "Same agent, target, method and value.")}
      </div>
      <div className={section}>
        <p className="label">Human approval</p>
        {unitField("Approval at or above (USD)", 6, doc.human_approval?.usd_threshold_micros, (d, v) => (d.human_approval.usd_threshold_micros = v))}
        <Field id={`${uid}-unknown`} label="Unknown methods on allowed contracts">
          <select id={`${uid}-unknown`} className={inputCls} value={doc.human_approval?.require_for_unknown_methods ? "review" : "deny"} onChange={(e) => edit((d) => (d.human_approval.require_for_unknown_methods = e.target.value === "review"))}>
            <option value="review">Send to a human (PS_HUMAN_001)</option>
            <option value="deny">Deny (PS_METHOD_001)</option>
          </select>
        </Field>
        <p className="text-[11.5px] text-muted">Failure mode is always <Mono>closed</Mono>: a missing policy, price or fee never allows.</p>
      </div>
      <div className={section}>
        <p className="label">Token spend · schema 1.5</p>
        <label className="flex items-start gap-2 text-[12px] text-soft">
          <input
            type="checkbox"
            checked={doc.token_spend?.enabled === true}
            onChange={(e) =>
              edit((d) => {
                if (e.target.checked) {
                  d.schema_version = "1.5";
                  d.token_spend = { enabled: true, max_transaction_usd_micros: "5000000", on_price_unavailable: "deny", max_closed_market_price_age_seconds: 259200, require_output_to_account: true, ...(d.token_spend ?? {}) };
                  d.token_spend.enabled = true;
                } else if (d.token_spend) d.token_spend.enabled = false;
              })
            }
            className="mt-0.5 accent-[#9cf6ee]"
          />
          <span>Count tokens in the limits. The per-transaction limit below, the hourly budget and the approval threshold then count every token a transaction spends or leaves approved, priced from Chainlink. Turning it on applies at once; turning it off waits the delay.</span>
        </label>
        {doc.token_spend?.enabled === true && (
          <>
            {unitField("Max per transaction, tokens included (USD)", 6, doc.token_spend?.max_transaction_usd_micros, (d, v) => (d.token_spend.max_transaction_usd_micros = v), "ETH sent, the fee and every token out, in USD.")}
            <Field id={`${uid}-noprice`} label="A spent token has no reliable price">
              <select id={`${uid}-noprice`} className={inputCls} value={doc.token_spend?.on_price_unavailable ?? "deny"} onChange={(e) => edit((d) => (d.token_spend.on_price_unavailable = e.target.value))}>
                <option value="deny">Deny (PS_PRICE_001)</option>
                <option value="review">Send to a human (PS_PRICE_001)</option>
              </select>
            </Field>
            <label className="flex items-start gap-2 text-[12px] text-soft">
              <input type="checkbox" checked={doc.token_spend?.require_output_to_account !== false} onChange={(e) => edit((d) => (d.token_spend.require_output_to_account = e.target.checked))} className="mt-0.5 accent-[#9cf6ee]" />
              <span>A swap&apos;s output must come back to the account.</span>
            </label>
          </>
        )}
      </div>
      <div className={section}>
        <p className="label">Contracts and methods · default deny</p>
        {allow.length === 0 ? (
          <p className="text-[12px] text-muted">Nothing is allowed yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {allow.map((c) => (
              <li key={c.address} className="flex items-start justify-between gap-2 text-[12px]">
                <span className="min-w-0">
                  <Mono className="block break-all text-soft">{c.address}</Mono>
                  <Mono className="text-dim">{c.selectors.join(", ") || "no methods"}{c.require_verified_code ? " · code required" : ""}</Mono>
                </span>
                <IconBtn label={`Remove ${c.address}`} tone="danger" onClick={() => edit((d) => (d.contracts.allowlist = allow.filter((x) => x.address !== c.address)))}><CloseIcon size={14} /></IconBtn>
              </li>
            ))}
          </ul>
        )}
        <input aria-label="Contract address" className={inputCls} value={contract} onChange={(e) => setContract(e.target.value.trim())} placeholder="0x… contract" spellCheck={false} />
        <input aria-label="Function selectors" className={inputCls} value={selectors} onChange={(e) => setSelectors(e.target.value)} placeholder="0xa9059cbb, 0x095ea7b3" spellCheck={false} />
        <label className="flex items-start gap-2 text-[12px] text-soft">
          <input type="checkbox" checked={requireCode} onChange={(e) => setRequireCode(e.target.checked)} className="mt-0.5 accent-[#9cf6ee]" />
          <span>Require deployed contract code. Denies the call if no contract exists at the address on the chain (for example a typo or an undeployed address).</span>
        </label>
        <p className="text-[11.5px] text-muted">Selectors are the first 4 bytes of the call data. <Mono>0xa9059cbb</Mono> is ERC-20 transfer, <Mono>0x095ea7b3</Mono> is approve.</p>
        <Btn
          variant="quiet"
          disabled={!/^0x[0-9a-fA-F]{40}$/.test(contract)}
          onClick={() => {
            edit((d) => {
              const list = d.contracts.allowlist as typeof allow;
              const sels = selectors.split(/[\s,]+/).filter((x) => /^0x[0-9a-fA-F]{8}$/.test(x)).map((x) => x.toLowerCase());
              const existing = list.find((x) => x.address.toLowerCase() === contract.toLowerCase());
              if (existing) existing.selectors = [...new Set([...existing.selectors, ...sels])];
              if (existing) existing.require_verified_code = requireCode;
              else list.push({ address: contract, selectors: sels, require_verified_code: requireCode });
            });
            setContract("");
          }}
        >
          Allow contract
        </Btn>
      </div>
      <div className={section}>
        <p className="label">Explicit deny · overrides allow</p>
        {denylist.map((d) => (
          <div key={d} className="flex items-center justify-between gap-2 text-[12px]">
            <Mono className="break-all text-deny">{d}</Mono>
            <IconBtn label={`Remove ${d}`} tone="danger" onClick={() => edit((x) => (x.contracts.denylist = denylist.filter((y) => y !== d)))}><CloseIcon size={14} /></IconBtn>
          </div>
        ))}
        <input aria-label="Address to deny" className={inputCls} value={deny} onChange={(e) => setDeny(e.target.value.trim())} placeholder="0x… address" spellCheck={false} />
        <Btn
          variant="quiet"
          disabled={!/^0x[0-9a-fA-F]{40}$/.test(deny)}
          onClick={() => {
            edit((d) => {
              if (!d.contracts.denylist.includes(deny)) d.contracts.denylist.push(deny);
            });
            setDeny("");
          }}
        >
          Deny address
        </Btn>
      </div>
    </Panel>
  );
}

interface TestResult {
  decision: "ALLOW" | "DENY" | "REQUIRES_HUMAN_SIGNATURE";
  reason_code: string | null;
  message: string;
  checks: CheckResult[];
  inputs: { fee_estimate_wei: string | null; eth_usd: { price_micros: string } | null };
}

/** Runs the editor's current document against one transaction with live fee and price. Records nothing. */
function TestPanel({ doc }: { doc: Record<string, unknown> }) {
  const uid = useId();
  const [to, setTo] = useState("");
  const [value, setValue] = useState("0");
  const [data, setData] = useState("0x");
  const [gas, setGas] = useState("100000");
  const [result, setResult] = useState<TestResult | null>(null);
  const { run, busy, notice } = useAction();
  const wei = parseUnits(value, 18);
  const ready = /^0x[0-9a-fA-F]{40}$/.test(to) && wei !== null && /^0x([0-9a-fA-F]{2})*$/.test(data) && /^\d+$/.test(gas);
  return (
    <Panel title="Test cases" bodyClassName="grid gap-3 p-4">
      <p className="text-[12px] leading-relaxed text-muted">
        Evaluate this draft against one transaction with the live fee and ETH price and an empty ledger (no budget used yet). Nothing is recorded.
      </p>
      <Field id={`${uid}-to`} label="Target">
        <input id={`${uid}-to`} className={inputCls} value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id={`${uid}-v`} label="Value (ETH)">
          <input id={`${uid}-v`} className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
        </Field>
        <Field id={`${uid}-g`} label="Gas limit">
          <input id={`${uid}-g`} className={inputCls} value={gas} onChange={(e) => setGas(e.target.value)} inputMode="numeric" />
        </Field>
      </div>
      <Field id={`${uid}-d`} label="Calldata">
        <input id={`${uid}-d`} className={inputCls} value={data} onChange={(e) => setData(e.target.value.trim())} spellCheck={false} />
      </Field>
      <Btn
        variant="ghost"
        disabled={busy || !ready}
        onClick={async () => {
          const r = await run(() =>
            api<TestResult>("/policies/test", { method: "POST", body: { document: doc, transaction: { to, value_wei: wei!.toString(), data, gas_limit: Number(gas) } } }),
          );
          if (r) setResult(r);
        }}
      >
        Run test
      </Btn>
      {notice}
      {result && (
        <div className="space-y-2 border-t border-line pt-3">
          <p className="flex flex-wrap items-center gap-2 text-[13px]">
            <DecisionPill decision={result.decision} />
            {result.reason_code && <Mono className="text-soft">{result.reason_code}</Mono>}
          </p>
          <p className="text-[12.5px] text-soft">{result.message}</p>
          <p className="text-[11.5px] text-muted">
            Fee bound {result.inputs.fee_estimate_wei ? `${formatUnits(result.inputs.fee_estimate_wei, 18)} ETH` : "unavailable"} · ETH/USD{" "}
            {result.inputs.eth_usd ? usd(result.inputs.eth_usd.price_micros) : "unavailable"}
          </p>
          <CheckList checks={result.checks.filter((c) => c.enforcement === "local")} />
        </div>
      )}
    </Panel>
  );
}

/** Field-by-field changes between two activated versions, or a version and the current draft. */
function VersionCompare({ policyId, versions, hasDraft }: { policyId: string; versions: number[]; hasDraft: boolean }) {
  const latest = versions[0]!;
  const [from, setFrom] = useState(String(versions[1] ?? latest));
  const [to, setTo] = useState(hasDraft ? "draft" : String(latest));
  const [result, setResult] = useState<{ changes: { path: string; from: unknown; to: unknown }[] } | null>(null);
  const { run, busy, notice } = useAction();
  const options = [...versions.map((v) => ({ value: String(v), label: `v${v}` })), ...(hasDraft ? [{ value: "draft", label: "draft" }] : [])];
  const show = (v: unknown) => (v === null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <div className="mt-4 space-y-2 border-t border-line pt-3">
      <p className="label">Compare</p>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <select aria-label="From version" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-[4px] border border-reef bg-ink px-2 py-1 text-fg">
          {options.filter((o) => o.value !== "draft").map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="text-dim">→</span>
        <select aria-label="To version" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-[4px] border border-reef bg-ink px-2 py-1 text-fg">
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <Btn variant="quiet" disabled={busy} onClick={() => run(() => api<{ changes: { path: string; from: unknown; to: unknown }[] }>(`/policies/${policyId}/compare?from=${from}&to=${to}`)).then((r) => r && setResult(r))}>
          Compare
        </Btn>
      </div>
      {notice}
      {result &&
        (result.changes.length === 0 ? (
          <p className="text-[12px] text-muted">No differences.</p>
        ) : (
          <ul className="max-h-[260px] space-y-1.5 overflow-y-auto">
            {result.changes.map((c) => (
              <li key={c.path} className="rounded-[6px] border border-line px-2.5 py-1.5 text-[11.5px]">
                <Mono className="block text-mist">{c.path}</Mono>
                <span className="block break-all text-deny/90">− {show(c.from)}</span>
                <span className="block break-all text-allow">+ {show(c.to)}</span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
