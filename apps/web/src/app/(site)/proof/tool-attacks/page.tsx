import type { Metadata } from "next";
import Link from "next/link";
import { pageOpenGraph } from "@/lib/seo";
import { Label, Result, Rows } from "@/components/line/parts";
import { PageHead, Split } from "@/components/line/split";
import results from "../../../../../attacks/results-mainnet.json";

export const metadata: Metadata = {
  title: "Tool attacks",
  description: "Attacks planted in an agent's tools, skills and tool results, run against our own demo agent on Robinhood Chain mainnet. The agent follows every order; Palisec checks the transaction and denies each one.",
  alternates: { canonical: "/proof/tool-attacks" },
  openGraph: pageOpenGraph("/proof/tool-attacks"),
};

interface Decision { decision: string; reason_code: string | null; operation_id?: string | null; detail?: string }
interface Row { id: string; title: string; planted_in: string; told: string; at: string; decisions: Decision[]; ok: boolean; nothing_on_chain: boolean | null }
const R = results as { network: string; account: string; run_at: string; agent: string; results: Row[]; control?: { at: string; what: string; decision: string; operation_id: string; tx: string | null } };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const utc = (iso: string) => iso.replace("T", " ").replace("Z", "") + " UTC";

export default function ToolAttacksPage() {
  const passed = R.results.filter((r) => r.ok).length;
  return (
    <>
      <PageHead
        label="Proof · Tool attacks"
        title="We attacked our own agent. In public."
        lede="An attacker can hide orders in anything an agent reads: a tool's description, a skill, an API response. Our test agent follows every one of them. Palisec checks the transaction, not the agent's reasoning, so none of them moved money."
        left={<p className="font-mono text-[0.8125rem] text-dim">{R.network} · account {short(R.account)} · run {utc(R.run_at)}</p>}
      />
      <Split
        left={<Label>Result</Label>}
        right={
          <div className="space-y-3">
            <p className="t-big">{passed} / {R.results.length} denied</p>
            <p className="t-body">Nothing reached the chain for any attack: the smart account&apos;s nonce did not move. The agent is {R.agent}, the worst case for a tricked agent.</p>
          </div>
        }
      />
      <Split
        left={<Label>Every attack</Label>}
        right={
          <Rows>
            {R.results.map((r) => {
              const last = r.decisions[r.decisions.length - 1]!;
              return (
                <li key={r.id} className="space-y-3 py-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h2 className="t-h3">{r.title}</h2>
                    <Result kind={r.ok ? "blocked" : "allowed"}>{last.decision === "NO_TOOL" ? "No tool can do it" : `${last.decision} ${last.reason_code ?? ""}`}</Result>
                  </div>
                  <p className="font-mono text-[0.75rem] uppercase tracking-[0.14em] text-dim">Planted in a {r.planted_in}</p>
                  <blockquote className="border-l-2 border-deny/60 pl-4 font-mono text-[0.8125rem] text-silver [overflow-wrap:anywhere]">{r.told}</blockquote>
                  <p className="font-mono text-[0.75rem] text-dim [overflow-wrap:anywhere]">
                    {r.decisions.length > 1 ? `${r.decisions.length} requests: ${r.decisions.filter((d) => d.decision === "DENY").length} denied. ` : ""}
                    {last.operation_id ? `Decision ${last.operation_id}. ` : ""}
                    {last.detail ?? ""}
                    {r.nothing_on_chain ? "Nothing on chain." : ""}
                  </p>
                </li>
              );
            })}
          </Rows>
        }
      />
      {R.control ? (
        <Split
          left={<Label>Control</Label>}
          right={
            <div className="space-y-2">
              <p className="t-body">The same agent still works: a normal payment the policy allows ({R.control.what}) was allowed and executed.</p>
              <p className="font-mono text-[0.8125rem] text-foam [overflow-wrap:anywhere]">
                {R.control.decision} · decision {R.control.operation_id}
                {R.control.tx ? <> · <a href={R.control.tx} target="_blank" rel="noopener noreferrer" className="text-aqua hover:underline">transaction ↗</a></> : null}
              </p>
            </div>
          }
        />
      ) : null}
      <Split
        left={<Label>Run it yourself</Label>}
        right={<p className="t-body">The attacks are data, and the runner works against any agent account. <Link href="/docs/tool-attacks" className="text-aqua hover:underline">How to run the suite</Link>.</p>}
      />
    </>
  );
}
