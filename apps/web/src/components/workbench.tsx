"use client";

import { useId, useMemo, useState } from "react";
import {
  EMPTY_STATE,
  EXAMPLE_ENV,
  EXAMPLE_ASSET_SAFETY,
  EXAMPLE_POLICY,
  exampleSimulation,
  NATIVE_TOKEN,
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
  type ReasonCode,
} from "@palisec/policy-schema";
import { Codes, DecisionBadge, type DecisionTone } from "./ui";
import { CopyButton } from "./copy-button";
import type { ReactNode } from "react";
import { ArrowRightIcon, BanIcon, CheckIcon, ClockIcon, CloseIcon, GaugeIcon, GlobeIcon, HandIcon, KeyIcon, PlayIcon, RepeatIcon, ResetIcon, SlidersIcon, ZapIcon } from "./icons";

const SCENARIO_ICON: Record<string, ReactNode> = {
  "token-transfer": <ArrowRightIcon size={16} />,
  swap: <RepeatIcon size={16} />,
  "large-swap": <RepeatIcon size={16} />,
  "over-limit": <GaugeIcon size={16} />,
  "unknown-method": <KeyIcon size={16} />,
  "unknown-target": <GlobeIcon size={16} />,
  "denied-target": <BanIcon size={16} />,
};
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
    // The example policy as a new policy gets it, with asset safety on.
    schema_version: "1.1",
    asset_safety: EXAMPLE_ASSET_SAFETY,
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

/** "browser": the evaluator on example data in this page. "live": the real dry-run endpoint on testnet. */
type Mode = "browser" | "live";

/** One evaluation as shown, from either mode. A live run without an answer has no decision. */
interface Shown {
  request_id: string;
  decision: DecisionTone | null;
  reason_code: ReasonCode | null;
  message: string;
  checks: CheckResult[] | null;
  response: unknown;
  live?: { apiRequestId: string | null; serverTime: string | null; errorCode: string | null };
}

interface HistoryRow {
  seq: number;
  t: number;
  scenario: string;
  mode: Mode;
  result: Shown;
}

type Tab = "checks" | "response" | "policy" | "ledger";

const fromBrowser = (r: EvaluationResult): Shown => ({
  request_id: r.request_id,
  decision: r.decision,
  reason_code: r.reason_code,
  message: r.message,
  checks: r.checks,
  response: {
    request_id: r.request_id,
    decision: r.decision,
    reason_code: r.reason_code,
    policy_id: r.policy_id,
    policy_version: r.policy_version,
    authorization_id: r.authorization_id,
    transaction_hash: r.transaction_hash,
    retryable: r.retryable,
    message: r.message,
  },
});

/** Asks the site's demo route, which holds the key server-side. Any failure is shown as an error, never a result. */
async function askLiveApi(scenarioId: string): Promise<Shown> {
  try {
    const res = await fetch("/api/demo/evaluate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: scenarioId }) });
    const body = (await res.json().catch(() => null)) as {
      api_request_id?: string | null;
      server_time?: string;
      request_id?: string;
      response?: { request_id?: string; decision?: DecisionTone; reason_code?: ReasonCode | null; message?: string; checks?: CheckResult[]; error?: { code: string; message: string } };
      error?: { code: string; message: string };
    } | null;
    const r = body?.response;
    if (res.ok && r?.decision) {
      return {
        request_id: r.request_id ?? "",
        decision: r.decision,
        reason_code: r.reason_code ?? null,
        message: r.message ?? "",
        checks: r.checks ?? null,
        response: body,
        live: { apiRequestId: body?.api_request_id ?? null, serverTime: body?.server_time ?? null, errorCode: null },
      };
    }
    const err = r?.error ?? body?.error;
    return {
      request_id: body?.api_request_id ?? body?.request_id ?? "",
      decision: null,
      reason_code: null,
      message: err ? `${err.message} (HTTP ${res.status})` : `The Palisec API answered HTTP ${res.status} without a decision.`,
      checks: null,
      response: body,
      live: { apiRequestId: body?.api_request_id ?? body?.request_id ?? null, serverTime: body?.server_time ?? null, errorCode: err?.code ?? `HTTP ${res.status}` },
    };
  } catch (e) {
    return {
      request_id: "",
      decision: null,
      reason_code: null,
      message: `The Palisec API could not be reached: ${e instanceof Error ? e.message : "network error"}.`,
      checks: null,
      response: null,
      live: { apiRequestId: null, serverTime: null, errorCode: "unreachable" },
    };
  }
}

export function Workbench() {
  const uid = useId();
  const [scenarioId, setScenarioId] = useState(SCENARIOS[1]!.id);
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);
  const [clock, setClock] = useState(0);
  const [ledger, setLedger] = useState<LedgerState>(EMPTY_STATE);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [tab, setTab] = useState<Tab>("checks");
  const [mode, setMode] = useState<Mode>("browser");
  const [busy, setBusy] = useState(false);

  const { policy, inputErrors } = useMemo(() => buildPolicy(controls), [controls]);
  const schemaErrors = useMemo(() => validatePolicy(policy), [policy]);
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const latest = history.find((h) => h.mode === mode)?.result ?? null;
  const now = SIM_EPOCH + clock;
  const live = mode === "live";

  const set = <K extends keyof Controls>(k: K, v: Controls[K]) => setControls((c) => ({ ...c, [k]: v }));

  async function submit() {
    const seq = history.length + 1;
    if (live) {
      setBusy(true);
      const shown = await askLiveApi(scenario.id);
      setBusy(false);
      setHistory((h) => [{ seq, t: clock, scenario: scenario.label, mode: "live" as const, result: shown }, ...h].slice(0, 50));
      setTab("checks");
      return;
    }
    const value = scenario.intent.value_wei;
    const result = evaluate(
      policy,
      {
        ...scenario.intent,
        request_id: `ps_req_sim_${String(seq).padStart(4, "0")}`,
        deadline: now + 120,
        asset_intent: { spend: value === "0" ? [] : [{ token: NATIVE_TOKEN, amount: value }], receive: [] },
      },
      ledger,
      {
        ...EXAMPLE_ENV,
        now,
        fee_estimate_wei: controls.feeOffline ? null : EXAMPLE_ENV.fee_estimate_wei,
        eth_usd: controls.priceOffline ? null : { price_micros: EXAMPLE_ENV.eth_usd!.price_micros, observed_at: now },
        emergency_stop: controls.emergencyStop,
        asset_simulation: exampleSimulation(scenario, now),
      },
    );
    setLedger(result.next_state);
    setHistory((h) => [{ seq, t: clock, scenario: scenario.label, mode: "browser" as const, result: fromBrowser(result) }, ...h].slice(0, 50));
    setTab("checks");
  }

  function reset() {
    setLedger(EMPTY_STATE);
    setHistory([]);
    setClock(0);
    setControls(DEFAULT_CONTROLS);
  }

  const policyJson = JSON.stringify(policy, null, 2);
  const blocked = busy || (!live && inputErrors.length > 0);

  return (
    <div className="panel panel-beam overflow-hidden">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="flex items-center gap-2 font-utility text-[14px] font-semibold text-mist"><SlidersIcon size={16} className="text-aqua" />Workbench</p>
          <div role="radiogroup" aria-label="Where the evaluation runs" className="grid grid-cols-2 overflow-hidden rounded-[6px] border border-reef">
            {([
              ["browser", "In your browser", "Runs locally on example data. Nothing is signed or broadcast."],
              ["live", "Live API", "Sends the example to the real Palisec dry-run endpoint on testnet. Nothing is reserved, recorded or sent."],
            ] as [Mode, string, string][]).map(([m, label, title]) => (
              <label key={m} title={title} className={`flex cursor-pointer items-center justify-center px-3 py-1 font-utility text-[12.5px] font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-aqua ${mode === m ? "bg-aqua text-abyss" : "text-soft hover:bg-raised"}`}>
                <input type="radio" className="sr-only" name={`${uid}-mode`} checked={mode === m} onChange={() => setMode(m)} />
                {label}
              </label>
            ))}
          </div>
          <p className="font-utility text-[12px] text-muted">{live ? "testnet · dry run · response from the Palisec API" : "Runs locally on example data"}</p>
        </div>
        <div className={`flex items-center gap-1 font-mono text-xs ${live ? "invisible" : ""}`} aria-hidden={live}>
          <span className="mr-2 flex items-center gap-1.5 text-muted" aria-live="polite">
            <ClockIcon size={14} aria-label="Simulated clock" role="img" aria-hidden={false} /> <span className="text-fg">T+{clock}s</span>
          </span>
          {[15, 60].map((s) => (
            <button key={s} type="button" onClick={() => setClock((c) => c + s)} className="rounded-[4px] border border-reef px-2 py-1 text-mist transition-colors hover:border-aqua hover:text-aqua" aria-label={`Advance simulated clock by ${s} seconds`}>
              +{s}s
            </button>
          ))}
          <button
            type="button"
            onClick={reset}
            aria-label="Reset the simulation"
            title="Reset the simulation"
            className="group/reset grid h-[26px] w-[26px] place-items-center rounded-[4px] border border-reef text-mist transition-colors hover:border-aqua hover:text-aqua"
          >
            <ResetIcon size={14} className="transition-transform duration-500 ease-[var(--ease-out-quint)] group-hover/reset:-rotate-180" />
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* inputs */}
        <div className="border-b border-line lg:border-b-0 lg:border-r">
          <fieldset className="border-b border-line p-4">
            <legend className="label float-left mb-3 w-full">Transaction</legend>
            <div className="clear-both grid grid-cols-2 gap-1.5">
              {SCENARIOS.map((s) => (
                <label
                  key={s.id}
                  title={s.summary}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-[8px] border px-3 py-2 text-[13.5px] transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-aqua ${
                    s.id === scenarioId ? "border-aqua/50 bg-raised text-mist" : "border-line text-soft hover:bg-raised/60"
                  }`}
                >
                  <input type="radio" name={`${uid}-scenario`} value={s.id} checked={s.id === scenarioId} onChange={() => setScenarioId(s.id)} className="sr-only" />
                  <span aria-hidden className={s.id === scenarioId ? "text-aqua" : "text-dim"}>{SCENARIO_ICON[s.id]}</span>
                  <span className="min-w-0 truncate">{s.label}</span>
                </label>
              ))}
            </div>
            <p className="mt-3 text-[13px] text-muted">{scenario.summary}</p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line pt-3 font-mono text-[12px]">
              <dt className="text-muted">to</dt>
              <dd className="truncate text-soft">{scenario.intent.to}</dd>
              <dt className="text-muted">selector</dt>
              <dd className="text-soft">{selectorOf(scenario.intent.data) ?? "— (native)"}</dd>
              <dt className="text-muted">value</dt>
              <dd className="text-soft">{formatUnits(scenario.intent.value_wei, 18)} ETH</dd>
            </dl>
          </fieldset>

          <fieldset disabled={live} className="border-b border-line p-4 disabled:opacity-50">
            <legend className="label float-left mb-3 w-full">Policy</legend>
            {live && <p className="clear-both mb-3 text-[12.5px] text-muted">Live API uses the demo organization&apos;s fixed policy on testnet. These fields apply in the browser only.</p>}
            <div className="clear-both grid grid-cols-2 gap-3">
              <NumField id={`${uid}-max`} label="Max value / tx" unit="ETH" value={controls.maxValueEth} onChange={(v) => set("maxValueEth", v)} />
              <NumField id={`${uid}-budget`} label="Hourly budget" unit="USD" value={controls.hourlyBudgetUsd} onChange={(v) => set("hourlyBudgetUsd", v)} />
              <NumField id={`${uid}-cool`} label="Calldata cooldown" unit="s" value={controls.calldataCooldown} onChange={(v) => set("calldataCooldown", v)} />
              <NumField id={`${uid}-human`} label="Approval above" unit="USD" value={controls.humanThresholdUsd} onChange={(v) => set("humanThresholdUsd", v)} />
            </div>
            <div className="mt-3">
              <p className="label mb-1.5" id={`${uid}-unk`}>Unknown methods</p>
              <div role="radiogroup" aria-labelledby={`${uid}-unk`} className="grid grid-cols-2 overflow-hidden rounded-[4px] border border-reef">
                {(["review", "deny"] as const).map((v) => (
                  <label key={v} className={`flex cursor-pointer items-center justify-center gap-2 px-3 py-1.5 font-utility text-[13px] font-semibold ${controls.unknownMethods === v ? "bg-aqua text-abyss" : "text-soft hover:bg-raised"}`}>
                    <input type="radio" className="sr-only" name={`${uid}-unk`} checked={controls.unknownMethods === v} onChange={() => set("unknownMethods", v)} />
                    {v === "review" ? <HandIcon size={15} /> : <BanIcon size={15} />}
                    {v === "review" ? "Review" : "Deny"}
                  </label>
                ))}
              </div>
            </div>
          </fieldset>

          <fieldset className="p-4">
            <legend className="label float-left mb-3 w-full">Inject a failure · simulated</legend>
            <div className={`clear-both space-y-2.5 ${live ? "opacity-50" : ""}`}>
              <Toggle label="Emergency stop" checked={controls.emergencyStop} disabled={live} onChange={(v) => set("emergencyStop", v)} />
              <Toggle label="Fee estimator down" checked={controls.feeOffline} disabled={live} onChange={(v) => set("feeOffline", v)} />
              <Toggle label="Price feed down" checked={controls.priceOffline} disabled={live} onChange={(v) => set("priceOffline", v)} />
            </div>
            {live && <p className="mt-2 text-[12.5px] text-muted">Browser only: never sent to the API.</p>}
            {!live && (inputErrors.length > 0 || schemaErrors.length > 0) && (
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
              <span className="flex items-center gap-2"><PlayIcon size={15} fill="currentColor" />{busy ? "Asking the API…" : live ? "Evaluate with the live API" : "Evaluate"}</span>
              <span className="font-mono text-xs opacity-70">#{String(history.length + 1).padStart(4, "0")}</span>
            </button>
          </fieldset>
        </div>

        {/* result */}
        <div className="flex min-w-0 flex-col">
          <div aria-live="polite" className="border-b border-line p-4">
            {latest ? (
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  {latest.decision ? (
                    <DecisionBadge decision={latest.decision} />
                  ) : (
                    <span className="inline-flex items-center rounded-[4px] px-2.5 py-1 font-utility text-[12px] font-semibold text-silver ring-1 ring-inset ring-line-strong">Unknown</span>
                  )}
                  {latest.reason_code && <code className="font-mono text-sm text-fg">{latest.reason_code}</code>}
                  {latest.reason_code && <span className="text-xs text-muted">{REASON_CODES[latest.reason_code]}</span>}
                  {latest.live?.errorCode && <code className="font-mono text-sm text-deny">{latest.live.errorCode}</code>}
                </div>
                <p key={`${latest.request_id}-${latest.live?.apiRequestId ?? ""}`} className="mt-3 max-w-[60ch] animate-[fade-up_.4s_ease-out] text-sm leading-relaxed text-soft">{latest.message}</p>
                {latest.live && (
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[11.5px]">
                    <dt className="text-muted">source</dt>
                    <dd className="text-soft">{latest.decision ? "testnet · dry run · response from the Palisec API" : "no result from the Palisec API"}</dd>
                    <dt className="text-muted">request ID</dt>
                    <dd className="break-all text-soft">{latest.live.apiRequestId ?? "—"}</dd>
                    <dt className="text-muted">server time</dt>
                    <dd className="text-soft">{latest.live.serverTime ?? "—"}</dd>
                  </dl>
                )}
              </div>
            ) : (
              <p className="flex items-center gap-2.5 text-[14px] text-muted">
                <ZapIcon size={16} className="text-aqua" />
                {live ? "Pick a transaction, then ask the live API. Dry runs reserve and record nothing." : "Pick a transaction, then evaluate. Repeat one to trip loop detection."}
              </p>
            )}
          </div>

          <div role="tablist" aria-label="Result views" className="flex overflow-x-auto border-b border-line">
            {([
              ["checks", "Checks"],
              ["response", "Response"],
              ["policy", "Policy"],
              ["ledger", live ? "Ledger" : `Ledger ${ledger.reservations.length}`],
            ] as [Tab, string][]).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                id={`${uid}-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`${uid}-panel`}
                onClick={() => setTab(id)}
                className={`relative shrink-0 border-r border-line px-4 py-2.5 font-utility text-[13px] font-semibold transition-colors ${tab === id ? "bg-raised text-aqua" : "text-muted hover:text-soft"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`} className="min-h-[420px] flex-1">
            {tab === "checks" && (latest && !latest.checks ? <Empty text="No checks: the API did not return a decision." /> : <ChecksView checks={latest?.checks ?? null} />)}
            {tab === "response" && (latest?.response ? <JsonView json={JSON.stringify(latest.response, null, 2)} label="Copy response JSON" /> : <Empty text="Evaluate a transaction to see the API response." />)}
            {tab === "policy" && (live ? <Empty text="Live API mode evaluates against the demo organization's fixed policy on testnet, held by the server. It cannot be edited from this page." /> : <JsonView json={policyJson} label="Copy policy JSON" />)}
            {tab === "ledger" && (live ? <Empty text="Dry runs reserve nothing, so there is no ledger. Every live request is evaluated against an empty budget." /> : <LedgerView ledger={ledger} now={now} />)}
          </div>

          {history.length > 0 && (
            <div className="border-t border-line">
              <p className="label px-4 pb-1 pt-3">History</p>
              <ol className="max-h-44 overflow-y-auto px-4 pb-3 font-mono text-[11px]">
                {history.map((h) => (
                  <li key={h.seq} className="grid grid-cols-[3.5rem_4rem_1fr_auto] gap-2 border-b border-line py-1.5 last:border-b-0">
                    <span className="text-dim">#{String(h.seq).padStart(4, "0")}</span>
                    <span className="text-muted">{h.mode === "live" ? "live" : `T+${h.t}s`}</span>
                    <span className="truncate text-soft">{h.scenario}</span>
                    <span className={h.result.decision === "ALLOW" ? "text-allow" : h.result.decision === "DENY" ? "text-deny" : h.result.decision ? "text-review" : "text-muted"}>
                      {h.result.decision ? h.result.reason_code ?? "ALLOW" : "Unknown"}
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
      <div className="flex overflow-hidden rounded-[4px] border border-reef transition-colors focus-within:border-aqua">
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

export function Toggle({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-3 text-sm text-soft ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
      {label}
      <span className="flex items-center">
        <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span aria-hidden className={`relative h-5 w-9 rounded-full border transition-colors peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fg ${checked ? "border-deny bg-deny/20" : "border-line-strong"}`}>
          <span className={`absolute top-[3px] h-3 w-3 rounded-full transition-all ${checked ? "left-[19px] bg-deny" : "left-[3px] bg-muted"}`} />
        </span>
      </span>
    </label>
  );
}

const STATUS_STYLE: Record<CheckResult["status"], { icon: ReactNode; cls: string; text: string }> = {
  pass: { icon: <CheckIcon size={15} strokeWidth={2.2} />, cls: "text-allow", text: "Pass" },
  fail: { icon: <CloseIcon size={15} strokeWidth={2.2} />, cls: "text-deny", text: "Fail" },
  review: { icon: <HandIcon size={15} />, cls: "text-review", text: "Review" },
  skipped: { icon: <span className="block h-px w-3 bg-current" />, cls: "text-dim", text: "Skipped" },
};

export function ChecksView({ checks }: { checks: CheckResult[] | null }) {
  if (!checks) return <OrderPreview />;
  // Behind the Upoch flag: its check is not listed while the flag is off.
  const local = checks.filter((c) => c.enforcement === "local" && (process.env.FEATURE_UPOCH === "true" || c.id !== "recovery"));
  const live = checks.filter((c) => c.enforcement === "live");
  return (
    <div>
      <ol className="divide-y divide-line">
        {local.map((c, i) => <CheckRow key={`${c.id}-${c.detail}`} check={c} index={i + 1} />)}
      </ol>
      <p className="label border-y border-line bg-ink px-4 py-2">Needs a live account. Not run here.</p>
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
      className="grid animate-[fade-up_.35s_ease-out_both] grid-cols-[2rem_1.75rem_minmax(0,1fr)] items-start gap-x-2 px-4 py-2"
      style={{ animationDelay: `${index * 35}ms` }}
    >
      <span className="font-mono text-[11px] text-dim">{String(index).padStart(2, "0")}</span>
      <span className={`grid h-5 place-items-center ${s.cls}`} title={s.text}>
        <span aria-hidden>{s.icon}</span>
        <span className="sr-only">{s.text}</span>
      </span>
      <span className="min-w-0">
        <span className={`block text-[13px] ${check.status === "skipped" ? "text-muted" : "text-fg"}`}>{check.label}</span>
        <span className="block break-words text-xs text-muted"><Codes text={check.detail} /></span>
      </span>
    </li>
  );
}

// The evaluation order, derived from the evaluator itself so it can never drift from what runs.
const ORDER = evaluate(EXAMPLE_POLICY, { ...SCENARIOS[1]!.intent, request_id: "ps_req_preview", deadline: SIM_EPOCH + 120 }, EMPTY_STATE, EXAMPLE_ENV).checks.filter((c) => process.env.FEATURE_UPOCH === "true" || c.id !== "recovery");

function OrderPreview() {
  return (
    <div>
      <p className="px-4 pb-2 pt-4 text-[13px] text-muted">The checks, in the order they run.</p>
      <ol className="divide-y divide-line">
        {ORDER.map((c, i) => (
          <li key={c.id} className="grid grid-cols-[2rem_1.75rem_minmax(0,1fr)] items-center gap-x-2 px-4 py-2">
            <span className="font-mono text-[11px] text-dim">{String(i + 1).padStart(2, "0")}</span>
            <span className="grid place-items-center" title={c.enforcement === "live" ? "Needs a live account" : "Queued"}>
              <span aria-hidden className={`h-3 w-3 rounded-full ${c.enforcement === "live" ? "border border-dashed border-dim" : "border border-line-strong"}`} />
              <span className="sr-only">{c.enforcement === "live" ? "Not run here" : "Queued"}</span>
            </span>
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
  if (ledger.reservations.length === 0) return <Empty text="No reservations yet. Allowed and pending operations hold budget here." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] font-mono text-[11px]">
        <thead>
          <tr className="text-left text-muted">
            {["reservation", "request", "amount", "state", "expires"].map((h) => (
              <th key={h} className="border-b border-line-strong px-4 py-2 font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...ledger.reservations].reverse().map((r) => (
            <tr key={r.reservation_id} className="border-b border-line">
              <td className="px-4 py-2 text-soft">{r.reservation_id.slice(0, 14)}…</td>
              <td className="px-4 py-2 text-muted">{r.request_id.replace("ps_req_sim_", "#")}</td>
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
