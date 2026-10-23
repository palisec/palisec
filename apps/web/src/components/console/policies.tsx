"use client";

import { useId, useMemo, useState } from "react";
import {
  EMPTY_STATE,
  SCENARIOS,
  evaluate,
  validatePolicy,
  type Decision,
  type Policy,
  type ValidationError,
} from "@palisec/policy-schema";
import { activateDraft, buildEnv, discardDraft, saveDraft, type SimState } from "@/lib/console-sim";
import { commit, useSim, useSimNow } from "@/lib/console-store";
import { formatSimTime, formatUnits, parseUnits } from "@/lib/units";
import { CopyButton } from "../copy-button";
import { Btn, Field, inputCls, Mono, Notice, PageTitle, Panel, Pill, Segmented } from "./kit";

// ───────── form model ─────────

interface AllowRow { address: string; selectors: string; verified: boolean }
interface Form {
  maxValueEth: string;
  maxGasEth: string;
  hourlyUsd: string;
  maxPending: string;
  priceAge: string;
  cdCalldata: string;
  cdIntent: string;
  humanUsd: string;
  unknown: "review" | "deny";
  allow: AllowRow[];
  deny: string;
}

const toForm = (p: Policy): Form => ({
  maxValueEth: formatUnits(p.limits.max_transaction_value_wei, 18),
  maxGasEth: formatUnits(p.limits.max_gas_cost_wei, 18),
  hourlyUsd: formatUnits(p.limits.hourly_budget_usd_micros, 6),
  maxPending: String(p.limits.max_pending_operations),
  priceAge: String(p.limits.max_price_age_seconds),
  cdCalldata: String(p.cooldowns.identical_calldata_seconds),
  cdIntent: String(p.cooldowns.identical_intent_seconds),
  humanUsd: formatUnits(p.human_approval.usd_threshold_micros, 6),
  unknown: p.human_approval.require_for_unknown_methods ? "review" : "deny",
  allow: p.contracts.allowlist.map((a) => ({ address: a.address, selectors: a.selectors.join(", "), verified: a.require_verified_code })),
  deny: p.contracts.denylist.join("\n"),
});

type FieldKey = keyof Form | `allow.${number}`;
interface InputError { field: FieldKey; message: string }

function fromForm(f: Form, base: Policy): { policy: Policy; inputErrors: InputError[] } {
  const inputErrors: InputError[] = [];
  const dec = (field: FieldKey, v: string, d: number, what: string) => {
    const n = parseUnits(v, d);
    if (n === null) inputErrors.push({ field, message: `${what} must be a decimal amount.` });
    return (n ?? 0n).toString();
  };
  const int = (field: FieldKey, v: string, what: string) => {
    if (!/^\d{1,9}$/.test(v.trim())) {
      inputErrors.push({ field, message: `${what} must be a whole number.` });
      return -1;
    }
    return Number(v);
  };
  const policy: Policy = {
    ...base,
    limits: {
      max_transaction_value_wei: dec("maxValueEth", f.maxValueEth, 18, "Max value"),
      max_gas_cost_wei: dec("maxGasEth", f.maxGasEth, 18, "Max gas cost"),
      hourly_budget_usd_micros: dec("hourlyUsd", f.hourlyUsd, 6, "Hourly budget"),
      max_pending_operations: int("maxPending", f.maxPending, "Max pending operations"),
      max_price_age_seconds: int("priceAge", f.priceAge, "Max price age"),
    },
    cooldowns: {
      identical_calldata_seconds: int("cdCalldata", f.cdCalldata, "Calldata cooldown"),
      identical_intent_seconds: int("cdIntent", f.cdIntent, "Intent cooldown"),
    },
    contracts: {
      default: "deny",
      allowlist: f.allow.map((a) => ({
        address: a.address.trim() as `0x${string}`,
        selectors: a.selectors.split(/[\s,]+/).filter(Boolean) as `0x${string}`[],
        require_verified_code: a.verified,
      })),
      denylist: f.deny.split(/\s+/).filter(Boolean) as `0x${string}`[],
    },
    human_approval: {
      usd_threshold_micros: dec("humanUsd", f.humanUsd, 6, "Approval threshold"),
      require_for_unknown_methods: f.unknown === "review",
    },
  };
  return { policy, inputErrors };
}

/** Schema paths -> the form field that edits them, so errors appear where they are fixed. */
function fieldFor(path: string): FieldKey | null {
  const map: Record<string, keyof Form> = {
    "limits.max_transaction_value_wei": "maxValueEth",
    "limits.max_gas_cost_wei": "maxGasEth",
    "limits.hourly_budget_usd_micros": "hourlyUsd",
    "limits.max_pending_operations": "maxPending",
    "limits.max_price_age_seconds": "priceAge",
    "cooldowns.identical_calldata_seconds": "cdCalldata",
    "cooldowns.identical_intent_seconds": "cdIntent",
    "human_approval.usd_threshold_micros": "humanUsd",
  };
  const p = path.replace(/^\$\.?/, "");
  if (map[p]) return map[p];
  const m = /contracts\.allowlist\[(\d+)\]/.exec(p);
  if (m) return `allow.${Number(m[1])}`;
  if (p.startsWith("contracts.denylist")) return "deny";
  return null;
}

/** Stable rule identifiers for review and audit: category prefix + position. */
function ruleIds(p: Policy): { id: string; category: string; path: string; value: string }[] {
  const rows = [
    { id: "R-LIM-01", category: "Transaction limits", path: "limits.max_transaction_value_wei", value: `${formatUnits(p.limits.max_transaction_value_wei, 18)} ETH` },
    { id: "R-LIM-02", category: "Transaction limits", path: "limits.max_gas_cost_wei", value: `${formatUnits(p.limits.max_gas_cost_wei, 18)} ETH` },
    { id: "R-BUD-01", category: "Budget window", path: "limits.hourly_budget_usd_micros", value: `$${formatUnits(p.limits.hourly_budget_usd_micros, 6)} / 3600 s` },
    { id: "R-BUD-02", category: "Budget window", path: "limits.max_pending_operations", value: String(p.limits.max_pending_operations) },
    { id: "R-BUD-03", category: "Budget window", path: "limits.max_price_age_seconds", value: `${p.limits.max_price_age_seconds} s` },
    { id: "R-CDN-01", category: "Cooldown", path: "cooldowns.identical_calldata_seconds", value: `${p.cooldowns.identical_calldata_seconds} s` },
    { id: "R-CDN-02", category: "Cooldown", path: "cooldowns.identical_intent_seconds", value: `${p.cooldowns.identical_intent_seconds} s` },
    ...p.contracts.allowlist.map((a, i) => ({ id: `R-CON-${String(i + 1).padStart(2, "0")}`, category: "Contract and method", path: `contracts.allowlist[${i}]`, value: `${a.address} · ${a.selectors.join(", ") || "no methods"}${a.require_verified_code ? " · verified code" : ""}` })),
    ...p.contracts.denylist.map((a, i) => ({ id: `R-DNY-${String(i + 1).padStart(2, "0")}`, category: "Contract and method", path: `contracts.denylist[${i}]`, value: a })),
    { id: "R-CON-00", category: "Contract and method", path: "contracts.default", value: p.contracts.default },
    { id: "R-HUM-01", category: "Human approval", path: "human_approval.usd_threshold_micros", value: `above $${formatUnits(p.human_approval.usd_threshold_micros, 6)}` },
    { id: "R-HUM-02", category: "Human approval", path: "human_approval.require_for_unknown_methods", value: p.human_approval.require_for_unknown_methods ? "unknown methods → review" : "unknown methods → deny" },
    { id: "R-FAI-01", category: "Failure mode", path: "failure_mode", value: p.failure_mode },
  ];
  return rows;
}

/** Line diff (LCS) between two JSON documents. */
function diffLines(a: string, b: string): { kind: " " | "+" | "-"; text: string }[] {
  const x = a.split("\n"), y = b.split("\n");
  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: { kind: " " | "+" | "-"; text: string }[] = [];
  let i = 0, j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { out.push({ kind: " ", text: x[i]! }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ kind: "-", text: x[i++]! });
    else out.push({ kind: "+", text: y[j++]! });
  }
  while (i < x.length) out.push({ kind: "-", text: x[i++]! });
  while (j < y.length) out.push({ kind: "+", text: y[j++]! });
  return out;
}

// ───────── view ─────────

export function PoliciesView() {
  const sim = useSim();
  // Remount the editor whenever the stored draft or active version changes.
  const key = `${sim.active_policy.version}-${sim.draft?.saved_at ?? "none"}`;
  const [flash, setFlash] = useState<Flash>(null);
  return <Editor key={key} sim={sim} flash={flash} setFlash={setFlash} />;
}

type Flash = { tone: "allow" | "deny"; text: string } | null;

type Tab = "json" | "validation" | "rules" | "diff" | "tests" | "versions";

function Editor({ sim, flash, setFlash }: { sim: SimState; flash: Flash; setFlash: (f: Flash) => void }) {
  const uid = useId();
  const now = useSimNow();
  const base = sim.draft?.policy ?? sim.active_policy;
  const [form, setForm] = useState<Form>(() => toForm(base));
  const [tab, setTab] = useState<Tab>("validation");
  const [note, setNote] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const { policy, inputErrors } = useMemo(() => fromForm(form, { ...base, status: "draft" }), [form, base]);
  const schemaErrors = useMemo(() => validatePolicy({ ...policy, status: "active" }), [policy]);
  const activeJson = JSON.stringify(sim.active_policy, null, 2);
  const draftJson = JSON.stringify(policy, null, 2);
  const changed = JSON.stringify({ ...policy, status: "x", version: 0 }) !== JSON.stringify({ ...sim.active_policy, status: "x", version: 0 });
  const unsaved = JSON.stringify(policy) !== JSON.stringify(sim.draft?.policy ?? { ...sim.active_policy, status: "draft" });
  const valid = inputErrors.length === 0 && schemaErrors.length === 0;

  const errorsFor = (f: FieldKey) => [
    ...inputErrors.filter((e) => e.field === f).map((e) => e.message),
    ...schemaErrors.filter((e) => fieldFor(e.path) === f).map((e) => `${e.path}: ${e.message}`),
  ];

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((s) => ({ ...s, [k]: v }));

  const tests = useMemo(() => {
    const env = buildEnv({ ...sim, breakers: { ...sim.breakers, global_stop: false }, agents: sim.agents.map((a) => ({ ...a, status: "active" as const })) }, now);
    return SCENARIOS.map((s) => {
      const intent = { ...s.intent, request_id: `rw_req_test_${s.id}`, deadline: now + 120 };
      const a = evaluate(sim.active_policy, intent, EMPTY_STATE, env);
      const d = evaluate(valid ? { ...policy, status: "active" } : null, intent, EMPTY_STATE, env);
      return { s, active: a, draft: d };
    });
  }, [sim, policy, valid, now]);
  const impact = tests.filter((t) => t.active.decision !== t.draft.decision || t.active.reason_code !== t.draft.reason_code).length;

  const steps = [
    { label: "Draft", done: sim.draft !== null || unsaved },
    { label: "Edit", done: changed },
    { label: "Validate", done: valid },
    { label: "Test", done: valid },
    { label: "Compare", done: changed },
    { label: "Activate", done: false },
  ];

  function save() {
    commit((s, t) => saveDraft(s, policy, t));
    setFlash({ tone: "allow", text: "Draft saved. It is not enforced until you activate it." });
  }

  function activate() {
    commit((s, t) => {
      const r = activateDraft(saveDraft(s, policy, t), t, note);
      if (!r.ok) {
        setFlash({ tone: "deny", text: r.error });
        return s;
      }
      setFlash({ tone: "allow", text: `Version ${r.state.active_policy.version} is active. The change is recorded in the version history and the audit trail.` });
      return r.state;
    });
  }

  function exportJson() {
    const url = URL.createObjectURL(new Blob([draftJson + "\n"], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${policy.policy_id}.draft.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageTitle
        title="Policy editor"
        description={<>Edit a draft of <Mono>{sim.active_policy.policy_id}</Mono>. Drafts are never enforced: a validated version is activated explicitly, recorded as a new version, and written to the audit trail.</>}
        actions={
          <>
            {sim.draft && <Pill tone="review">◆ Draft from v{sim.draft.based_on} · saved {formatSimTime(sim.draft.saved_at).slice(11, 19)}</Pill>}
            {unsaved && <Pill tone="info">Unsaved changes</Pill>}
          </>
        }
      />

      <ol aria-label="Activation workflow" className="mb-4 flex flex-wrap gap-2">
        {steps.map((s, i) => (
          <li key={`${s.label}-${s.done}`} className={`flex animate-[c-pop_.4s_var(--ease-out-quint)_both] items-center gap-2 rounded-[4px] px-2 py-1 font-utility transition-shadow duration-500 text-[10.5px] uppercase tracking-[0.06em] ${s.done ? "text-citrine shadow-[inset_0_0_0_1px_rgb(229_255_93/0.35)]" : "text-stone shadow-[inset_0_0_0_1px_var(--color-line-strong)]"}`}>
            <span className="tabular-nums text-dim">{i + 1}</span>
            {s.label}
            <span aria-hidden>{s.done ? "✓" : ""}</span>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* LEFT · CONFIGURATION */}
        <Panel title="Configuration · rule builder">
          <nav aria-label="Rule categories" className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
            {["Contract and method", "Transaction limits", "Budget window", "Cooldown", "Human approval", "Failure mode"].map((c) => (
              <a key={c} href={`#${uid}-${c.replace(/\s/g, "")}`} className="rounded-[4px] px-2 py-1 font-utility text-[10px] uppercase tracking-[0.05em] text-stone shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:text-citrine">{c}</a>
            ))}
          </nav>

          <div className="divide-y divide-line">
            <Section id={`${uid}-Contractandmethod`} title="Contract and method" rule="R-CON · R-DNY">
              <p className="text-[12.5px] text-muted">Default for any unlisted target: <Mono className="text-soft">deny</Mono> (fixed by the schema).</p>
              <ul className="mt-3 space-y-3">
                {form.allow.map((row, i) => {
                  const errs = errorsFor(`allow.${i}`);
                  return (
                    <li key={i} className="rounded-[6px] border border-line p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <Mono className="text-dim">R-CON-{String(i + 1).padStart(2, "0")}</Mono>
                        <Btn variant="quiet" onClick={() => set("allow", form.allow.filter((_, k) => k !== i))} aria-label={`Remove allowlist entry ${i + 1}`}>Remove</Btn>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Field id={`${uid}-a${i}`} label="Contract address">
                          <input id={`${uid}-a${i}`} value={row.address} spellCheck={false} aria-invalid={errs.length > 0} onChange={(e) => set("allow", form.allow.map((r, k) => (k === i ? { ...r, address: e.target.value } : r)))} className={inputCls} />
                        </Field>
                        <Field id={`${uid}-s${i}`} label="Allowed selectors">
                          <input id={`${uid}-s${i}`} value={row.selectors} spellCheck={false} placeholder="0xa9059cbb, …" aria-invalid={errs.length > 0} onChange={(e) => set("allow", form.allow.map((r, k) => (k === i ? { ...r, selectors: e.target.value } : r)))} className={inputCls} />
                        </Field>
                      </div>
                      <label className="mt-2 flex items-center gap-2 text-[13px] text-soft">
                        <input type="checkbox" checked={row.verified} onChange={(e) => set("allow", form.allow.map((r, k) => (k === i ? { ...r, verified: e.target.checked } : r)))} className="accent-[#e5ff5d]" />
                        Require verified contract code
                      </label>
                      <Errors list={errs} />
                    </li>
                  );
                })}
              </ul>
              <Btn variant="quiet" className="mt-3" onClick={() => set("allow", [...form.allow, { address: "0x", selectors: "", verified: true }])}>Add allowlist entry</Btn>
              <div className="mt-4">
                <Field id={`${uid}-deny`} label="Denylist · one address per line" hint="An explicit deny always overrides an allow.">
                  <textarea id={`${uid}-deny`} rows={2} value={form.deny} spellCheck={false} onChange={(e) => set("deny", e.target.value)} className={inputCls} aria-invalid={errorsFor("deny").length > 0} />
                </Field>
                <Errors list={errorsFor("deny")} />
              </div>
            </Section>

            <Section id={`${uid}-Transactionlimits`} title="Transaction limits" rule="R-LIM">
              <div className="grid gap-3 sm:grid-cols-2">
                <Num uid={uid} k="maxValueEth" label="Max value per transaction" unit="ETH" form={form} set={set} errors={errorsFor("maxValueEth")} />
                <Num uid={uid} k="maxGasEth" label="Max gas cost" unit="ETH" form={form} set={set} errors={errorsFor("maxGasEth")} />
              </div>
            </Section>

            <Section id={`${uid}-Budgetwindow`} title="Budget window" rule="R-BUD">
              <div className="grid gap-3 sm:grid-cols-3">
                <Num uid={uid} k="hourlyUsd" label="Rolling hourly budget" unit="USD" form={form} set={set} errors={errorsFor("hourlyUsd")} />
                <Num uid={uid} k="maxPending" label="Max pending operations" unit="ops" form={form} set={set} errors={errorsFor("maxPending")} />
                <Num uid={uid} k="priceAge" label="Max price age" unit="s" form={form} set={set} errors={errorsFor("priceAge")} />
              </div>
              <p className="mt-2 text-[12px] text-muted">Window is a rolling 3600 s. USD limits fail closed when the price is older than the max age.</p>
            </Section>

            <Section id={`${uid}-Cooldown`} title="Cooldown" rule="R-CDN">
              <div className="grid gap-3 sm:grid-cols-2">
                <Num uid={uid} k="cdCalldata" label="Identical calldata" unit="s" form={form} set={set} errors={errorsFor("cdCalldata")} />
                <Num uid={uid} k="cdIntent" label="Identical intent" unit="s" form={form} set={set} errors={errorsFor("cdIntent")} />
              </div>
            </Section>

            <Section id={`${uid}-Humanapproval`} title="Human approval" rule="R-HUM">
              <div className="grid gap-3 sm:grid-cols-2">
                <Num uid={uid} k="humanUsd" label="Require approval above" unit="USD" form={form} set={set} errors={errorsFor("humanUsd")} />
                <div>
                  <p className="label mb-1.5">Unknown methods</p>
                  <Segmented label="Unknown methods" value={form.unknown} onChange={(v) => set("unknown", v)} options={[{ value: "review", label: "Human review" }, { value: "deny", label: "Deny" }]} />
                </div>
              </div>
            </Section>

            <Section id={`${uid}-Failuremode`} title="Failure mode" rule="R-FAI">
              <p className="text-[13px] text-soft"><Mono className="text-citrine">closed</Mono> · the only supported mode. Failed, ambiguous, timed-out or unverifiable checks end in no signature.</p>
            </Section>
          </div>
        </Panel>

        {/* RIGHT · GENERATED POLICY */}
        <div className="min-w-0 space-y-4">
          <Panel
            title="Generated policy"
            actions={
              <>
                <Pill key={String(valid)} tone={valid ? "allow" : "deny"} className="animate-[c-pop_.4s_var(--ease-out-quint)]">{valid ? "✓ Schema valid" : `■ ${inputErrors.length + schemaErrors.length} errors`}</Pill>
                <CopyButton text={draftJson} label="Copy policy JSON" />
                <Btn variant="quiet" onClick={exportJson}>Export</Btn>
              </>
            }
          >
            <div className="border-b border-line px-4 py-2">
              <Segmented
                label="Generated policy views"
                value={tab}
                onChange={setTab}
                options={[
                  { value: "validation", label: "Validation", count: inputErrors.length + schemaErrors.length },
                  { value: "json", label: "JSON" },
                  { value: "rules", label: "Rule IDs" },
                  { value: "diff", label: "Diff" },
                  { value: "tests", label: "Test cases", count: impact },
                  { value: "versions", label: "Versions", count: sim.versions.length },
                ]}
              />
            </div>
            <div key={tab} className="max-h-[620px] min-h-[320px] animate-[c-fade_.3s_var(--ease-out-quint)] overflow-auto">
              {tab === "json" && <pre className="p-4 font-mono text-[12px] leading-relaxed text-soft"><code>{draftJson}</code></pre>}
              {tab === "validation" && <Validation inputErrors={inputErrors} schemaErrors={schemaErrors} meta={{ policy_id: policy.policy_id, schema: policy.schema_version, base: sim.draft?.based_on ?? sim.active_policy.version, next: Math.max(...sim.versions.map((v) => v.version)) + 1 }} />}
              {tab === "rules" && <Rules policy={policy} />}
              {tab === "diff" && <Diff from={activeJson} to={draftJson} activeVersion={sim.active_policy.version} />}
              {tab === "tests" && <Tests tests={tests} valid={valid} />}
              {tab === "versions" && <Versions sim={sim} onLoad={(p) => { setForm(toForm(p)); setTab("diff"); }} />}
            </div>
          </Panel>

          <Panel title="Save and activate">
            <div className="space-y-3 px-4 py-4">
              <div className="flex flex-wrap gap-2">
                <Btn variant="ghost" onClick={save} disabled={!unsaved}>Save draft</Btn>
                <Btn variant="quiet" onClick={() => { setForm(toForm(sim.active_policy)); commit((s, t) => discardDraft(s, t)); setFlash(null); }} disabled={!sim.draft && !unsaved}>Discard draft</Btn>
              </div>
              {!confirming ? (
                <Btn variant="primary" onClick={() => setConfirming(true)} disabled={!valid || !changed} title={!valid ? "Fix validation errors first" : !changed ? "The draft matches the active version" : undefined}>
                  Activate as v{Math.max(...sim.versions.map((v) => v.version)) + 1}
                </Btn>
              ) : (
                <div role="group" aria-label="Confirm activation" className="space-y-3 rounded-[6px] border border-line-strong bg-ink p-3">
                  <p className="text-[13px] leading-relaxed text-soft">
                    Activating replaces v{sim.active_policy.version} for every agent. {impact} of {tests.length} test cases change outcome.
                    {sim.operations.some((o) => o.status === "pending_approval") && " Pending approvals evaluated under the old version will be invalidated."}
                  </p>
                  <Field id={`${uid}-note`} label="Change note (recorded with the version)">
                    <input id={`${uid}-note`} value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} className={inputCls} />
                  </Field>
                  <label className="flex items-start gap-2 text-[13px] text-soft">
                    <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-0.5 accent-[#e5ff5d]" />
                    I reviewed the diff and the test-case impact.
                  </label>
                  <div className="flex gap-2">
                    <Btn variant="primary" disabled={!reviewed} onClick={activate}>Activate</Btn>
                    <Btn variant="quiet" onClick={() => setConfirming(false)}>Cancel</Btn>
                  </div>
                </div>
              )}
              {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Section({ id, title, rule, children }: { id: string; title: string; rule: string; children: React.ReactNode }) {
  return (
    <fieldset id={id} className="scroll-mt-20 px-4 py-4">
      <legend className="float-left mb-3 flex w-full items-center justify-between">
        <span className="text-[14px] font-semibold text-bone">{title}</span>
        <Mono className="text-dim">{rule}</Mono>
      </legend>
      <div className="clear-both">{children}</div>
    </fieldset>
  );
}

function Num({ uid, k, label, unit, form, set, errors }: { uid: string; k: keyof Form; label: string; unit: string; form: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void; errors: string[] }) {
  const id = `${uid}-${k}`;
  return (
    <div>
      <label htmlFor={id} className="label mb-1.5 block">{label}</label>
      <div className={`flex overflow-hidden rounded-[4px] border transition-colors focus-within:border-citrine ${errors.length ? "border-deny/70" : "border-graphite"}`}>
        <input id={id} inputMode="decimal" autoComplete="off" spellCheck={false} value={form[k] as string} aria-invalid={errors.length > 0} aria-describedby={errors.length ? `${id}-err` : undefined} onChange={(e) => set(k, e.target.value as never)} className="min-w-0 flex-1 bg-ink px-2.5 py-1.5 font-mono text-[12.5px] text-fg outline-none" />
        <span className="flex items-center border-l border-line px-2 font-mono text-[11px] text-muted">{unit}</span>
      </div>
      <Errors id={`${id}-err`} list={errors} />
    </div>
  );
}

function Errors({ list, id }: { list: string[]; id?: string }) {
  if (!list.length) return null;
  return (
    <ul key={list.join("|")} id={id} className="mt-1.5 animate-[c-shake_.4s] space-y-0.5 font-mono text-[11px] text-deny">
      {list.map((e) => <li key={e}>■ {e}</li>)}
    </ul>
  );
}

function Validation({ inputErrors, schemaErrors, meta }: { inputErrors: InputError[]; schemaErrors: ValidationError[]; meta: { policy_id: string; schema: string; base: number; next: number } }) {
  return (
    <div className="space-y-4 p-4">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-line bg-line font-mono text-[11.5px] sm:grid-cols-4">
        {[["Policy", meta.policy_id], ["Schema", meta.schema], ["Based on", `v${meta.base}`], ["Activates as", `v${meta.next}`]].map(([k, v]) => (
          <div key={k} className="bg-surface px-3 py-2"><dt className="text-dim">{k}</dt><dd className="mt-0.5 text-soft">{v}</dd></div>
        ))}
      </dl>
      {inputErrors.length === 0 && schemaErrors.length === 0 ? (
        <Notice tone="allow">✓ The draft passes canonical schema 1.0 validation (<Mono>validatePolicy</Mono>). Validation runs on every change; activation runs it again.</Notice>
      ) : (
        <ul className="divide-y divide-line rounded-[6px] border border-deny/40">
          {inputErrors.map((e) => <li key={`i-${e.field}-${e.message}`} className="px-3 py-2 text-[13px] text-soft"><span className="font-mono text-[11px] text-deny">INPUT · {e.field}</span><br />{e.message}</li>)}
          {schemaErrors.map((e) => <li key={`s-${e.path}-${e.message}`} className="px-3 py-2 text-[13px] text-soft"><span className="font-mono text-[11px] text-deny">SCHEMA · {e.path}</span><br />{e.message}</li>)}
        </ul>
      )}
    </div>
  );
}

function Rules({ policy }: { policy: Policy }) {
  return (
    <table className="w-full text-[12.5px]">
      <thead className="sticky top-0 bg-surface text-left">
        <tr>{["Rule", "Category", "Path", "Value"].map((h) => <th key={h} className="label border-b border-line-strong px-3 py-2 !text-[10px] font-normal">{h}</th>)}</tr>
      </thead>
      <tbody>
        {ruleIds(policy).map((r) => (
          <tr key={r.id + r.path} className="border-b border-line align-top">
            <td className="px-3 py-2 font-mono text-citrine">{r.id}</td>
            <td className="px-3 py-2 text-muted">{r.category}</td>
            <td className="px-3 py-2 font-mono text-[11px] text-stone">{r.path}</td>
            <td className="break-all px-3 py-2 font-mono text-[11px] text-soft">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Diff({ from, to, activeVersion }: { from: string; to: string; activeVersion: number }) {
  const lines = diffLines(from, to).filter((l) => !/"(status|version)"/.test(l.text) || l.kind === " ");
  const changes = lines.filter((l) => l.kind !== " ").length;
  return (
    <div>
      <p className="border-b border-line px-4 py-2 font-mono text-[11px] text-muted">active v{activeVersion} → draft · {changes} changed lines (status and version omitted)</p>
      <pre className="p-0 font-mono text-[12px] leading-relaxed">
        {lines.map((l, i) => (
          <div key={i} className={`${l.kind === "+" ? "animate-[c-notice_.4s_var(--ease-out-quint)_both] bg-citrine/[0.08] text-citrine" : l.kind === "-" ? "animate-[c-notice_.4s_var(--ease-out-quint)_both] bg-deny/[0.08] text-deny" : "text-muted"}`}>
            <span aria-hidden className="inline-block w-6 select-none text-center">{l.kind}</span>
            <span className="sr-only">{l.kind === "+" ? "added: " : l.kind === "-" ? "removed: " : ""}</span>
            {l.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

const DECISION_SHORT: Record<Decision, string> = { ALLOW: "ALLOW", DENY: "DENY", REQUIRES_HUMAN_SIGNATURE: "REVIEW" };
const decisionCls = (d: Decision) => (d === "ALLOW" ? "text-citrine" : d === "DENY" ? "text-deny" : "text-sand");

function Tests({ tests, valid }: { tests: { s: (typeof SCENARIOS)[number]; active: ReturnType<typeof evaluate>; draft: ReturnType<typeof evaluate> }[]; valid: boolean }) {
  return (
    <div>
      <p className="border-b border-line px-4 py-2 text-[12.5px] text-muted">
        Each illustrative transaction evaluated from empty state under the active version and the draft. {valid ? "" : "The draft is invalid, so it evaluates as a missing policy (RW_POLICY_001)."}
      </p>
      <table className="w-full text-[12.5px]">
        <thead className="text-left">
          <tr>{["Test case", "Active", "Draft", ""].map((h, i) => <th key={i} className="label border-b border-line-strong px-3 py-2 !text-[10px] font-normal">{h}</th>)}</tr>
        </thead>
        <tbody>
          {tests.map(({ s, active, draft }) => {
            const diff = active.decision !== draft.decision || active.reason_code !== draft.reason_code;
            return (
              <tr key={s.id} className={`border-b border-line ${diff ? "bg-sand/[0.05]" : ""}`}>
                <td className="px-3 py-2"><span className="text-soft">{s.label}</span><br /><span className="text-[11.5px] text-muted">{s.summary}</span></td>
                <td className={`px-3 py-2 font-mono text-[11px] ${decisionCls(active.decision)}`}>{DECISION_SHORT[active.decision]}<br /><span className="text-dim">{active.reason_code ?? "—"}</span></td>
                <td className={`px-3 py-2 font-mono text-[11px] ${decisionCls(draft.decision)}`}>{DECISION_SHORT[draft.decision]}<br /><span className="text-dim">{draft.reason_code ?? "—"}</span></td>
                <td className="px-3 py-2">{diff && <Pill tone="review">changed</Pill>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Versions({ sim, onLoad }: { sim: SimState; onLoad: (p: Policy) => void }) {
  return (
    <ol className="divide-y divide-line">
      {[...sim.versions].reverse().map((v) => (
        <li key={v.version} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-[13.5px] text-bone">
              v{v.version} {v.version === sim.active_policy.version && <Pill tone="allow" className="c-burst ml-1">active</Pill>}
            </p>
            <p className="text-[12px] text-muted">{formatSimTime(v.activated_at)} · {v.activated_by} · “{v.note}”</p>
          </div>
          {v.version !== sim.active_policy.version && <Btn variant="quiet" onClick={() => onLoad(v.policy)}>Load into draft</Btn>}
        </li>
      ))}
    </ol>
  );
}
