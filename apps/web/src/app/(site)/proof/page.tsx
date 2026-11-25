import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { pageOpenGraph } from "@/lib/seo";
import { NETWORKS, MAINNET } from "@/lib/networks";
import { publicFacts, publicProof, publicRegistry } from "@/server/public-data";
import { Accent, Framed, Label, LineButton, Result, Rows } from "@/components/line/parts";
import { Split } from "@/components/line/split";
import { ProofTable } from "@/components/line/proof-table";

export const metadata: Metadata = {
  title: "Proof",
  description: "Real decisions from Palisec's public demo accounts on Robinhood Chain mainnet, with each account's policy and stop state read from the ERC-8511 registry.",
  alternates: { canonical: "/proof" },
  openGraph: pageOpenGraph("/proof"),
};

const EXPLORER = NETWORKS[MAINNET].explorer;

/** Read at most every 5 minutes, so page views never each wake the database or the chain. */
async function proofData() {
  "use cache";
  cacheLife({ stale: 300, revalidate: 300, expire: 86400 });
  return Promise.all([publicFacts(), publicProof({ limit: 25, page: 1, result: "all" }), publicRegistry()]);
}

export default async function ProofPage() {
  const [facts, proof, registry] = await proofData();
  const totals = [
    { v: facts?.allowed_24h ?? null, label: "Allowed", cls: "text-allow" },
    { v: facts?.blocked_24h ?? null, label: "Blocked, nothing signed", cls: "text-deny" },
    { v: facts?.held_24h ?? null, label: "Held for a person", cls: "text-review" },
  ];

  return (
    <>
      <Split
        as="header"
        className="!pt-[10.625rem]"
        left={
          <div className="space-y-11">
            <Label>Proof · last 24 h</Label>
            {totals.map((t) =>
              t.v !== null ? (
                <div key={t.label}>
                  <p className="t-big">{t.v.toLocaleString("en-US")}</p>
                  <p className={`mt-3 font-mono text-[0.8125rem] uppercase tracking-[0.14em] ${t.cls}`}>{t.label}</p>
                </div>
              ) : null,
            )}
          </div>
        }
        right={
          <div className="space-y-7">
            <h1 className="t-h1">Every decision, <Accent>on the record.</Accent></h1>
            <p className="t-lede">Real decisions from our public demo accounts on Robinhood Chain mainnet. Check any of them on the explorer.</p>
          </div>
        }
      />

      <Split left={<Label>Decisions</Label>} right={<ProofTable initial={proof} />} />

      <Split
        left={<div className="space-y-4"><Label>Registry state</Label><p className="t-body text-silver">Read from the ERC-8511 registry v3 on chain.</p></div>}
        right={
          registry ? (
            <Rows>
              {registry.accounts.map((a) => (
                <li key={a.account} className="grid gap-3 py-5 md:grid-cols-[1fr_auto] md:items-center">
                  <div className="space-y-1 font-mono text-[0.8438rem]">
                    <p className="text-mist">{a.label}</p>
                    <p className="break-all text-dim">policy {a.policy_hash ? `${a.policy_hash.slice(0, 18)}…` : "none"} · version {a.version ?? "—"}</p>
                  </div>
                  <div className="flex items-center gap-5">
                    <Result kind={a.stopped ? "blocked" : "allowed"}>{a.stopped ? (a.stop_held_by_account ? "Stopped · held by the account" : "Stopped") : "Running"}</Result>
                    <a href={`${EXPLORER}/address/${a.registry}?tab=read_contract`} target="_blank" rel="noopener noreferrer" className="font-mono text-[0.8125rem] text-silver hover:text-aqua">verify ↗</a>
                  </div>
                </li>
              ))}
            </Rows>
          ) : (
            <p className="t-body">The registry can&apos;t be read right now.</p>
          )
        }
      />

      <Split
        left={<Label>Linked track record</Label>}
        right={
          <Framed className="space-y-5 p-7">
            <p className="t-label">Zolva · paper trading, virtual money</p>
            <p className="t-body">
              A Palisec agent linked to its Zolva agent shows Zolva&apos;s track record next to its limits: return since start, worst drop and the replay check. The link is
              proven from both sides on chain.
            </p>
            <LineButton href="/m/palisec-demo" variant="ghost" small>The demo&apos;s record →</LineButton>
          </Framed>
        }
      />
    </>
  );
}
