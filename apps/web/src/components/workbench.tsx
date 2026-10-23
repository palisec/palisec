"use client";

import { useId, useMemo, useState } from "react";
import {
  EMPTY_STATE,
  EXAMPLE_ENV,
  EXAMPLE_POLICY,
  REASON_CODES,
  SCENARIOS,
  SIM_EPOCH,
  evaluate,
  formatUsd,
  selectorOf,
  validatePolicy,
  type CheckResult,
  type EvaluationResult,
  type LedgerState,
  type Policy,
} from "@palisec/policy-schema";
import { Codes, DecisionBadge } from "./ui";
import { CopyButton } from "./copy-button";
import { formatUnits, parseUnits } from "@/lib/units";


interface Controls {
  maxValueEth: string;
  hourlyBudgetUsd: string;
  calldataCooldown: string;
  humanThresholdUsd: string;
  unknownMethods: "review" | "deny";
  emergencyStop: boolean;
  feeOffline: boolean;
  priceOffline: boolean;
}

const DEFAULT_CONTROLS: Controls = {
  maxValueEth: formatUnits(EXAMPLE_POLICY.limits.max_transaction_value_wei, 18),
  hourlyBudgetUsd: formatUnits(EXAMPLE_POLICY.limits.hourly_budget_usd_micros, 6),
  calldataCooldown: String(EXAMPLE_POLICY.cooldowns.identical_calldata_seconds),
  humanThresholdUsd: formatUnits(EXAMPLE_POLICY.human_approval.usd_threshold_micros, 6),
  unknownMethods: "review",
  emergencyStop: false,
  feeOffline: false,
  priceOffline: false,
};

function buildPolicy(c: Controls): { policy: Policy; inputErrors: string[] } {
  const inputErrors: string[] = [];
  const wei = parseUnits(c.maxValueEth, 18);
  const budget = parseUnits(c.hourlyBudgetUsd, 6);
  const threshold = parseUnits(c.humanThresholdUsd, 6);
  const cooldown = /^\d{1,5}$/.test(c.calldataCooldown) ? Number(c.calldataCooldown) : NaN;
  if (wei === null) inputErrors.push("Max value must be a decimal ETH amount.");
  if (budget === null) inputErrors.push("Hourly budget must be a decimal USD amount.");
  if (threshold === null) inputErrors.push("Approval threshold must be a decimal USD amount.");
  if (Number.isNaN(cooldown)) inputErrors.push("Cooldown must be whole seconds.");
  const policy: Policy = {
    ...EXAMPLE_POLICY,
    limits: {
      ...EXAMPLE_POLICY.limits,
      max_transaction_value_wei: (wei ?? 0n).toString(),
      hourly_budget_usd_micros: (budget ?? 0n).toString(),
    },
    cooldowns: { ...EXAMPLE_POLICY.cooldowns, identical_calldata_seconds: Number.isNaN(cooldown) ? -1 : cooldown },
    human_approval: {
      usd_threshold_micros: (threshold ?? 0n).toString(),
      require_for_unknown_methods: c.unknownMethods === "review",
    },
  };
  return { policy, inputErrors };
}

interface HistoryRow {
  seq: number;
  t: number;
  scenario: string;
  result: EvaluationResult;
}

type Tab = "checks" | "response" | "policy" | "ledger";

export function Workbench() {
  const uid = useId();
  const [scenarioId, setScenarioId] = useState(SCENARIOS[1]!.id);
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);
  const [clock, setClock] = useState(0);
  const [ledger, setLedger] = useState<LedgerState>(EMPTY_STATE);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [tab, setTab] = useState<Tab>("checks");

  const { policy, inputErrors } = useMemo(() => buildPolicy(controls), [controls]);
  const schemaErrors = useMemo(() => validatePolicy(policy), [policy]);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const latest = history[0]?.result ?? null;
  const now = SIM_EPOCH + clock;

  const set = <K extends keyof Controls>(k: K, v: Controls[K]) => setControls((c) => ({ ...c, [k]: v }));

  function submit() {
    const seq = history.length + 1;
    const result = evaluate(
      policy,
      { ...scenario.intent, request_id: `rw_req_sim_${String(seq).padStart(4, "0")}`, deadline: now + 120 },
      ledger,
      {
        ...EXAMPLE_ENV,
        now,
        fee_estimate_wei: controls.feeOffline ? null : EXAMPLE_ENV.fee_estimate_wei,
        eth_usd: controls.priceOffline ? null : { price_micros: EXAMPLE_ENV.eth_usd!.price_micros, observed_at: now },
        emergency_stop: controls.emergencyStop,
      },
    );
    setLedger(result.next_state);
    setHistory((h) => [{ seq, t: clock, scenario: scenario.label, result }, ...h].slice(0, 50));
    setTab("checks");
  }

  function reset() {
    setLedger(EMPTY_STATE);
    setHistory([]);
    setClock(0);
    setControls(DEFAULT_CONTROLS);
  }

  const response = latest && {
    request_id: latest.request_id,
    decision: latest.decision,
    reason_code: latest.reason_code,
    policy_id: latest.policy_id,
    policy_version: latest.policy_version,
    authorization_id: latest.authorization_id,
    transaction_hash: latest.transaction_hash,
    retryable: latest.retryable,
    message: latest.message,
  };
  const policyJson = JSON.stringify(policy, null, 2);
  const blocked = inputErrors.length > 0;

  return (
    <div className="panel panel-beam overflow-hidden">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="flex items-center gap-2.5 font-utility text-[11px] tracking-[0.08em] text-bone"><span aria-hidden className="tick-dot" />POLICY WORKBENCH</p>
          <p className="label !text-sand">◆ Simulation · example data · nothing is signed or broadcast</p>
        </div>
        <div className="flex items-center gap-1 font-mono text-xs">
          <span className="mr-2 text-muted" aria-live="polite">
            CLOCK <span className="text-fg">T+{clock}s</span>
          </span>
          {[15, 60].map((s) => (
            <button key={s} type="button" onClick={() => setClock((c) => c + s)} className="rounded-[4px] border border-graphite px-2 py-1 text-bone transition-colors hover:border-citrine hover:text-citrine" aria-label={`Advance simulated clock by ${s} seconds`}>
              +{s}s
            </button>
          ))}
          <button type="button" onClick={reset} className="rounded-[4px] border border-graphite px-2 py-1 text-bone transition-colors hover:border-citrine hover:text-citrine">
            Reset
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* inputs */}
        <div className="border-b border-line lg:border-b-0 lg:border-r">
          <fieldset className="border-b border-line p-4">
            <legend className="label float-left mb-3 w-full">1 · Transaction</legend>
            <div className="clear-both space-y-px">
              {SCENARIOS.map((s) => (
                <label
                  key={s.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-[8px] border px-3 py-2.5 transition-colors ${
                    s.id === scenarioId ? "border-citrine/50 bg-raised" : "border-transparent hover:bg-raised/60"
                  }`}
                >
                  <input type="radio" name={`${uid}-scenario`} value={s.id} checked={s.id === scenarioId} onChange={() => setScenarioId(s.id)} className="mt-1 accent-[#e5ff5d]" />
                  <span className="min-w-0">
                    <span className="block text-sm text-fg">{s.label}</span>
                    <span className="block text-xs text-muted">{s.summary}</span>
                  </span>
                </label>
              ))}
            </div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line pt-3 font-mono text-[11px]">
              <dt className="text-muted">to</dt>
              <dd className="truncate text-soft">{scenario.intent.to}</dd>
              <dt className="text-muted">selector</dt>
              <dd className="text-soft">{selectorOf(scenario.intent.data) ?? "— (native)"}</dd>
              <dt className="text-muted">value</dt>
              <dd className="text-soft">{formatUnits(scenario.intent.value_wei, 18)} ETH</dd>
            </dl>
          </fieldset>

          <fieldset className="border-b border-line p-4">
            <legend className="label float-left mb-3 w-full">2 · Policy</legend>
            <div className="clear-both grid grid-cols-2 gap-3">
              <NumField id={`${uid}-max`} label="Max value / tx" unit="ETH" value={controls.maxValueEth} onChange={(v) => set("maxValueEth", v)} />
              <NumField id={`${uid}-budget`} label="Hourly budget" unit="USD" value={controls.hourlyBudgetUsd} onChange={(v) => set("hourlyBudgetUsd", v)} />
              <NumField id={`${uid}-cool`} label="Calldata cooldown" unit="s" value={controls.calldataCooldown} onChange={(v) => set("calldataCooldown", v)} />
              <NumField id={`${uid}-human`} label="Approval above" unit="USD" value={controls.humanThresholdUsd} onChange={(v) => set("humanThresholdUsd", v)} />
            </div>
            <div className="mt-3">
              <p className="label mb-1.5" id={`${uid}-unk`}>Unknown methods</p>
              <div role="radiogroup" aria-labelledby={`${uid}-unk`} className="grid grid-cols-2 overflow-hidden rounded-[4px] border border-graphite">
                {(["review", "deny"] as const).map((v) => (
                  <label key={v} className={`cursor-pointer px-3 py-1.5 text-center font-mono text-xs ${controls.unknownMethods === v ? "bg-citrine text-carbon" : "text-soft hover:bg-raised"}`}>
                    <input type="radio" className="sr-only" name={`${uid}-unk`} checked={controls.unknownMethods === v} onChange={() => set("unknownMethods", v)} />
                    {v === "review" ? "Human review" : "Deny"}
                  </label>
                ))}
              </div>
            </div>
          </fieldset>

          <fieldset className="p-4">
            <legend className="label float-left mb-3 w-full">3 · Failure injection</legend>
            <div className="clear-both space-y-2">
              <Toggle label="Global emergency stop" checked={controls.emergencyStop} onChange={(v) => set("emergencyStop", v)} />
              <Toggle label="Fee estimator unavailable" checked={controls.feeOffline} onChange={(v) => set("feeOffline", v)} />
              <Toggle label="Price feed unavailable" checked={controls.priceOffline} onChange={(v) => set("priceOffline", v)} />
            </div>
            {(inputErrors.length > 0 || schemaErrors.length > 0) && (
              <ul className="mt-3 space-y-1 border-l-2 border-deny pl-3 font-mono text-[11px] text-deny" role="alert">
                {inputErrors.map((e) => <li key={e}>{e}</li>)}
                {!blocked && schemaErrors.map((e) => <li key={e.path}>{e.path}: {e.message}</li>)}
              </ul>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={blocked}
              className="btn btn-solid btn-primary group mt-4 h-12 w-full justify-between !px-4 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
            >
              Evaluate locally
              <span className="font-mono text-xs">rw_req_sim_{String(history.length + 1).padStart(4, "0")}</span>
            </button>
          </fieldset>
        </div>

        {/* result */}
        <div className="flex min-w-0 flex-col">
          <div aria-live="polite" className="border-b border-line p-4">
            {latest ? (
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <DecisionBadge decision={latest.decision} />
                  {latest.reason_code && <code className="font-mono text-sm text-fg">{latest.reason_code}</code>}
                  {latest.reason_code && <span className="text-xs text-muted">{REASON_CODES[latest.reason_code]}</span>}
                </div>
                <p key={latest.request_id} className="mt-3 max-w-[60ch] animate-[fade-up_.4s_ease-out] text-sm leading-relaxed text-soft">{latest.message}</p>
              </div>
            ) : (
              <div>
                <p className="font-mono text-xs text-muted">NO EVALUATION YET</p>
                <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-muted">
                  Pick a transaction and evaluate it. Submit the same one twice to trigger loop detection, advance the clock to clear
                  cooldowns, or keep allowing swaps until the hourly budget runs out.
                </p>
              </div>
            )}
          </div>

          <div role="tablist" aria-label="Result views" className="flex overflow-x-auto border-b border-line">
            {([
              ["checks", "Checks"],
              ["response", "Response"],
              ["policy", "Policy JSON"],
              ["ledger", `Ledger · ${ledger.reservations.length}`],
            ] as [Tab, string][]).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                id={`${uid}-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`${uid}-panel`}
                onClick={() => setTab(id)}
                className={`relative shrink-0 border-r border-line px-4 py-2.5 text-[12px] font-medium tracking-[0.032em] transition-colors ${tab === id ? "bg-raised text-citrine" : "text-muted hover:text-soft"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`} className="min-h-[420px] flex-1">
            {tab === "checks" && <ChecksView checks={latest?.checks ?? null} />}
            {tab === "response" && (response ? <JsonView json={JSON.stringify(response, null, 2)} label="Copy response JSON" /> : <Empty text="Evaluate a transaction to see the API response shape." />)}
            {tab === "policy" && <JsonView json={policyJson} label="Copy policy JSON" />}
            {tab === "ledger" && <LedgerView ledger={ledger} now={now} />}
          </div>

          {history.length > 0 && (
            <div className="border-t border-line">
              <p className="label px-4 pb-1 pt-3">History</p>
              <ol className="max-h-44 overflow-y-auto px-4 pb-3 font-mono text-[11px]">
                {history.map((h) => (
                  <li key={h.seq} className="grid grid-cols-[3.5rem_4rem_1fr_auto] gap-2 border-b border-line py-1.5 last:border-b-0">
                    <span className="text-dim">#{String(h.seq).padStart(4, "0")}</span>
                    <span className="text-muted">T+{h.t}s</span>
                    <span className="truncate text-soft">{h.scenario}</span>
                    <span className={h.result.decision === "ALLOW" ? "text-allow" : h.result.decision === "DENY" ? "text-deny" : "text-review"}>
                      {h.result.reason_code ?? "ALLOW"}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function NumField({ id, label, unit, value, onChange }: { id: string; label: string; unit: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="label mb-1.5 block">{label}</label>
      <div className="flex overflow-hidden rounded-[4px] border border-graphite transition-colors focus-within:border-citrine">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 font-mono text-sm text-fg"
        />
        <span className="flex items-center border-l border-line px-2 font-mono text-[11px] text-muted">{unit}</span>
      </div>
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-soft">
      {label}
      <span className="flex items-center gap-2">
        <span className={`font-mono text-[11px] ${checked ? "text-deny" : "text-dim"}`}>{checked ? "ON" : "OFF"}</span>
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span aria-hidden className={`relative h-4 w-7 border transition-colors peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fg ${checked ? "border-deny bg-deny/20" : "border-line-strong"}`}>
          <span className={`absolute top-0.5 h-2.5 w-2.5 transition-all ${checked ? "left-3.5 bg-deny" : "left-0.5 bg-muted"}`} />
        </span>
      </span>
    </label>
  );
}

const STATUS_STYLE: Record<CheckResult["status"], { glyph: string; cls: string; text: string }> = {
  pass: { glyph: "✓", cls: "text-citrine", text: "PASS" },
  fail: { glyph: "■", cls: "text-deny", text: "FAIL" },
  review: { glyph: "◆", cls: "text-sand", text: "REVIEW" },
  skipped: { glyph: "·", cls: "text-dim", text: "SKIP" },
};

export function ChecksView({ checks }: { checks: CheckResult[] | null }) {
  if (!checks) return <OrderPreview />;
  const local = checks.filter((c) => c.enforcement === "local");
  const live = checks.filter((c) => c.enforcement === "live");
  return (
    <div>
      <ol className="divide-y divide-line">
        {local.map((c, i) => <CheckRow key={`${c.id}-${c.detail}`} check={c} index={i + 1} />)}
      </ol>
      <p className="label border-y border-line bg-ink px-4 py-2">Requires a live protected account · not run here</p>
      <ol className="divide-y divide-line opacity-70">
        {live.map((c, i) => <CheckRow key={c.id} check={c} index={local.length + i + 1} />)}
      </ol>
    </div>
  );
}

function CheckRow({ check, index }: { check: CheckResult; index: number }) {
  const s = STATUS_STYLE[check.status];
  return (
    <li
      className="grid animate-[fade-up_.35s_ease-out_both] grid-cols-[2rem_4.5rem_minmax(0,1fr)] gap-x-2 px-4 py-2"
      style={{ animationDelay: `${index * 35}ms` }}
    >
      <span className="font-mono text-[11px] text-dim">{String(index).padStart(2, "0")}</span>
      <span className={`font-mono text-[11px] ${s.cls}`}>
        <span aria-hidden>{s.glyph} </span>
        {s.text}
      </span>
      <span className="min-w-0">
        <span className={`block text-[13px] ${check.status === "skipped" ? "text-muted" : "text-fg"}`}>{check.label}</span>
        <span className="block break-words text-xs text-muted"><Codes text={check.detail} /></span>
      </span>
    </li>
  );
}

// The evaluation order, derived from the evaluator itself so it can never drift from what runs.
const ORDER = evaluate(EXAMPLE_POLICY, { ...SCENARIOS[1]!.intent, request_id: "rw_req_preview", deadline: SIM_EPOCH + 120 }, EMPTY_STATE, EXAMPLE_ENV).checks;

function OrderPreview() {
  return (
    <div>
      <p className="px-4 pb-2 pt-4 text-sm text-muted">Press Evaluate locally to run the queued checks, in this order. Checks marked not run need a live protected account and never run here.</p>
      <ol className="divide-y divide-line">
        {ORDER.map((c, i) => (
          <li key={c.id} className="grid grid-cols-[2rem_4.5rem_minmax(0,1fr)] gap-x-2 px-4 py-2">
            <span className="font-mono text-[11px] text-dim">{String(i + 1).padStart(2, "0")}</span>
            <span className="font-mono text-[11px] text-dim"><span aria-hidden>{c.enforcement === "live" ? "— " : "· "}</span>{c.enforcement === "live" ? "NOT RUN" : "QUEUED"}</span>
            <span className={`text-[13px] ${c.enforcement === "live" ? "text-muted" : "text-soft"}`}>{c.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function JsonView({ json, label }: { json: string; label: string }) {
  return (
    <div className="relative">
      <div className="absolute right-3 top-3">
        <CopyButton text={json} label={label} />
      </div>
      <pre className="max-h-[560px] overflow-auto p-4 pr-20 font-mono text-[12px] leading-relaxed text-soft">
        <code>{json}</code>
      </pre>
    </div>
  );
}

function LedgerView({ ledger, now }: { ledger: LedgerState; now: number }) {
  if (ledger.reservations.length === 0) return <Empty text="No reservations. Allowed and pending operations reserve budget here until they finalize, expire or are released." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] font-mono text-[11px]">
        <thead>
          <tr className="text-left text-muted">
            {["reservation", "request", "amount", "state", "expires"].map((h) => (
              <th key={h} className="border-b border-line-strong px-4 py-2 font-normal uppercase tracking-[0.08em]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...ledger.reservations].reverse().map((r) => (
            <tr key={r.reservation_id} className="border-b border-line">
              <td className="px-4 py-2 text-soft">{r.reservation_id.slice(0, 14)}…</td>
              <td className="px-4 py-2 text-muted">{r.request_id.replace("rw_req_sim_", "#")}</td>
              <td className="px-4 py-2 text-soft">{formatUsd(BigInt(r.amount_usd_micros))}</td>
              <td className={`px-4 py-2 ${r.state === "pending_approval" ? "text-review" : r.state === "released" ? "text-dim" : "text-soft"}`}>{r.state}</td>
              <td className="px-4 py-2 text-muted">{r.state === "released" ? "—" : `${Math.max(0, r.expires_at - now)}s`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="max-w-[52ch] p-4 text-sm leading-relaxed text-muted">{text}</p>;
}
