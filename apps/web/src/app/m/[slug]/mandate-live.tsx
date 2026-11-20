"use client";

import { useEffect, useState } from "react";

/** The public mandate, refreshed every 15 seconds. Everything shown comes from the server's real data. */
export interface PublicMandate {
  slug: string;
  name: string;
  demo: boolean;
  chain_id: number;
  token: { address: string; symbol: string };
  rules: { voting_period_seconds: number; quorum: string; pass_bps: number; proposer_min: string };
  smart_account: string | null;
  cosigner: string | null;
  emergency_stop: boolean;
  envelope: { max_transaction_value_wei: string; max_hourly_budget_usd_micros: string; min_approval_threshold_usd_micros: string; allowed_contracts: { address: string; selectors: string[] }[] };
  active: { version: number; since: string; max_transaction_value_wei: string; hourly_budget_usd_micros: string; approval_threshold_usd_micros: string; allowlist: { address: string; selectors: string[] }[]; denylist: string[] } | null;
  proposals: {
    id: string;
    number: number;
    title: string;
    change: Record<string, unknown>;
    proposer: string;
    snapshot_block: string;
    opens_at: string;
    closes_at: string;
    state: string;
    tally: { for: string; against: string; abstain: string; cast: string; quorum: string; quorum_reached: boolean; passed: boolean };
    votes: { voter: string; choice: string; weight: string }[];
    policy_version: number | null;
    applied: string | null;
    pending: { state: string; effective_at: string; resolution: string | null; resolved_at: string | null } | null;
  }[];
  decisions: { id: string; decision: string; reason_code: string | null; transaction_hash: string | null; executed: boolean | null; at: string }[];
  read_at: string;
}

const EXPLORER = "https://robinhoodchain.blockscout.com";
const eth = (wei: string) => `${(Number(BigInt(wei)) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH`;
const usd = (micros: string) => `$${(Number(BigInt(micros)) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tok = (v: string) => (Number(BigInt(v) / 10n ** 14n) / 1e4).toLocaleString("en-US", { maximumFractionDigits: 4 });
const utc = (iso: string) => `${iso.replace("T", " ").slice(0, 19)} UTC`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
function left(ms: number | null) {
  if (ms === null) return "…";
  if (ms <= 0) return "now";
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}h ` : ""}${m}m ${String(s % 60).padStart(2, "0")}s`;
}
function describe(c: Record<string, unknown>) {
  switch (c.kind) {
    case "set_hourly_budget": return `Hourly budget → ${usd(String(c.usd_micros))}`;
    case "set_max_transaction_value": return `Per-transaction limit → ${eth(String(c.wei))}`;
    case "set_approval_threshold": return `Human approval at or above → ${usd(String(c.usd_micros))}`;
    case "allow_contract": return `Allow ${short(String(c.address))} (${(c.selectors as string[]).join(", ") || "no functions"})`;
    case "remove_contract": return `Remove ${short(String(c.address))} from the allowlist`;
    case "add_deny": return `Deny ${short(String(c.address))}`;
    case "remove_deny": return `Stop denying ${short(String(c.address))}`;
    default: return String(c.kind);
  }
}
const Link = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="font-mono text-mist underline decoration-line-strong underline-offset-4 hover:text-aqua">{children}</a>
);
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[16px] border border-line bg-abyss/40 p-5">
      <h3 className="mb-3 font-utility text-[13px] uppercase tracking-[0.08em] text-muted">{title}</h3>
      {children}
    </section>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-t border-line py-2 text-[14px] first:border-t-0">
      <span className="text-muted">{k}</span>
      <span className="text-right text-mist">{v}</span>
    </div>
  );
}

export function MandateLive({ slug, initial }: { slug: string; initial: PublicMandate }) {
  const [d, setD] = useState(initial);
  // The clock starts after hydration: server and browser render the same markup first (no React #418).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const start = setTimeout(() => setNow(Date.now()), 0);
    const poll = setInterval(() => {
      fetch(`/api/v1/public/mandates/${slug}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j && setD(j))
        .catch(() => {});
    }, 15_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      clearTimeout(start);
    };
  }, [slug]);

  const pending = d.proposals.find((p) => p.pending?.state === "pending");
  return (
    <div className="space-y-5">
      {d.demo && (
        <p className="rounded-[6px] border border-review/50 bg-review/[0.06] px-4 py-3 text-[13.5px] text-review">
          ● Demo mandate: 1-hour votes so the whole flow can be shown in a day. Real mandates use 24 to 72 hours.
        </p>
      )}
      {d.emergency_stop && (
        <p className="rounded-[6px] border border-deny/60 bg-deny/[0.08] px-4 py-3 text-[13.5px] text-deny">■ Emergency stop is engaged: every request from this agent is denied, whatever the mandate allows.</p>
      )}
      {pending?.pending && (
        <p className="rounded-[6px] border border-review/50 bg-review/[0.06] px-4 py-3 text-[13.5px] text-mist">
          <span className="text-review">● Pending: </span>proposal #{pending.number} ({describe(pending.change)}) passed and loosens the limits, so it waits.
          It applies in <span className="font-mono text-review">{left(now === null ? null : new Date(pending.pending.effective_at).getTime() - now)}</span> ({utc(pending.pending.effective_at)}) unless the
          owner or an operator cancels it; a cancel and its reason appear here.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Agent">
          <Row k="Smart account" v={d.smart_account ? <Link href={`${EXPLORER}/address/${d.smart_account}`}>{short(d.smart_account)}</Link> : "—"} />
          <Row k="Palisec co-signer" v={d.cosigner ? <Link href={`${EXPLORER}/address/${d.cosigner}`}>{short(d.cosigner)}</Link> : "—"} />
          <Row k="Network" v={d.chain_id === 4663 ? "Robinhood Chain mainnet (4663)" : String(d.chain_id)} />
          <Row k="Voting token" v={<Link href={`${EXPLORER}/token/${d.token.address}`}>${d.token.symbol}</Link>} />
          <Row k="Voting" v={`${Math.round(d.rules.voting_period_seconds / 60)} min · quorum ${tok(d.rules.quorum)} · passes above ${d.rules.pass_bps / 100}%`} />
          <Row k="Emergency stop" v={d.emergency_stop ? <span className="text-deny">Engaged</span> : "Off"} />
        </Card>
        <Card title="Active limits (enforced now)">
          {d.active ? (
            <>
              <Row k="Policy version" v={`v${d.active.version} · since ${utc(d.active.since)}`} />
              <Row k="Per-transaction value" v={eth(d.active.max_transaction_value_wei)} />
              <Row k="Hourly budget" v={usd(d.active.hourly_budget_usd_micros)} />
              <Row k="Human approval at or above" v={usd(d.active.approval_threshold_usd_micros)} />
              <Row k="Allowed contracts" v={d.active.allowlist.length ? d.active.allowlist.map((a) => short(a.address)).join(", ") : "none"} />
            </>
          ) : (
            <p className="text-muted">No active policy: every request is denied.</p>
          )}
        </Card>
      </div>

      <Card title="Envelope (the owner's hard limits; votes cannot go past these)">
        <Row k="Per-transaction value at most" v={eth(d.envelope.max_transaction_value_wei)} />
        <Row k="Hourly budget at most" v={usd(d.envelope.max_hourly_budget_usd_micros)} />
        <Row k="Human approval threshold at least" v={usd(d.envelope.min_approval_threshold_usd_micros)} />
        <Row k="Contracts a vote may allow" v={d.envelope.allowed_contracts.map((c) => `${short(c.address)} (${c.selectors.join(", ") || "none"})`).join("; ") || "none"} />
      </Card>

      <Card title={`Proposals · ${d.proposals.length}`}>
        {d.proposals.length === 0 && <p className="text-muted">No proposals yet.</p>}
        <div className="space-y-4">
          {d.proposals.map((p) => {
            const open = p.state === "open";
            return (
              <div key={p.id} className="rounded-[10px] border border-line p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-mist">#{p.number} · {p.title}</p>
                  <span className={`font-utility text-[12.5px] ${p.state === "passed" ? "text-allow" : p.state === "open" ? "text-review" : "text-deny"}`}>
                    {open ? `voting · ${left(now === null ? null : new Date(p.closes_at).getTime() - now)} left` : p.state}
                    {p.applied ? ` · ${p.pending?.state === "cancelled" ? "cancelled" : p.pending?.state === "applied" ? "applied after the delay" : p.applied === "pending" ? "pending" : "applied at once"}` : ""}
                  </span>
                </div>
                <p className="mt-1 text-[13.5px] text-muted">{describe(p.change)} · snapshot block {p.snapshot_block} · closes {utc(p.closes_at)}</p>
                <p className="mt-2 font-mono text-[13px] text-mist">
                  for {tok(p.tally.for)} · against {tok(p.tally.against)} · abstain {tok(p.tally.abstain)} · quorum {p.tally.quorum_reached ? "reached" : "not reached"}
                </p>
                {p.votes.length > 0 && (
                  <ul className="mt-2 space-y-0.5 font-mono text-[12.5px] text-muted">
                    {p.votes.map((v) => (
                      <li key={v.voter}>{v.voter} · {v.choice} · {tok(v.weight)}</li>
                    ))}
                  </ul>
                )}
                {p.pending?.state === "cancelled" && <p className="mt-2 text-[13px] text-deny">Cancelled {p.pending.resolved_at ? utc(p.pending.resolved_at) : ""}: {p.pending.resolution?.replace(/^mandate: /, "")}</p>}
                <p className="mt-2 text-[12.5px]">
                  <a className="text-silver underline decoration-line-strong underline-offset-4 hover:text-aqua" href={`/api/v1/public/mandates/${d.slug}/proposals/${p.id}/vote-file`}>
                    Download the vote file
                  </a>
                  <span className="text-dim"> · every signature, weight and the snapshot balances, for an independent recount</span>
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Recent decisions">
        {d.decisions.length === 0 && <p className="text-muted">No decisions yet.</p>}
        <ul className="space-y-1 text-[13.5px]">
          {d.decisions.map((x) => (
            <li key={x.id} className="flex flex-wrap justify-between gap-2 border-t border-line py-1.5 first:border-t-0">
              <span className={x.decision === "ALLOW" ? "text-allow" : x.decision === "DENY" ? "text-deny" : "text-review"}>
                {x.decision === "ALLOW" ? "Allowed" : x.decision === "DENY" ? "Denied" : "Held for a person"}
                {x.reason_code ? ` · ${x.reason_code}` : ""}
              </span>
              <span className="text-muted">
                {x.transaction_hash ? <Link href={`${EXPLORER}/tx/${x.transaction_hash}`}>{short(x.transaction_hash)}</Link> : null} {utc(x.at)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-[12px] text-dim">Read {utc(d.read_at)} from Palisec&apos;s records and Robinhood Chain. Refreshes every 15 seconds.</p>
    </div>
  );
}
