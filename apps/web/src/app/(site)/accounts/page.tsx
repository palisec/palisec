import type { Metadata } from "next";
import manifest from "../../../../../../deployments/robinhood-mainnet.json";
import { pageOpenGraph } from "@/lib/seo";
import { NETWORKS, MAINNET } from "@/lib/networks";
import { Accent, Label, Result, Rows } from "@/components/line/parts";
import { PageHead, Split } from "@/components/line/split";

export const metadata: Metadata = {
  title: "Accounts",
  description: "Each agent gets a Safe smart account with three owners; any transaction needs two of them, and Palisec co-signs only what passes your limits.",
  alternates: { canonical: "/accounts" },
  openGraph: pageOpenGraph("/accounts"),
};

const EXPLORER = NETWORKS[MAINNET].explorer;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const OWNERS = [
  { who: "Agent key", what: "Proposes every transaction. Signs first.", when: "signs", accent: false },
  { who: "Palisec co-signer", what: "Signs only what passes your limits, for that exact payload.", when: "signs if allowed", accent: true },
  { who: "Your recovery wallet", what: "Yours alone. Recovers or moves the account if you need to.", when: "only when you choose", accent: false },
];

const DEPLOYED = [
  ...manifest.contracts.filter((c) => ["singleton", "proxyFactory", "safe4337Module", "entryPoint"].includes(c.app_key ?? "")),
  ...manifest.palisec_deployed_contracts.filter((c) => c.name.startsWith("Policy registry v3")),
];

export default function AccountsPage() {
  return (
    <>
      <PageHead
        label="Product · Accounts"
        title={<>An account your agent <Accent>can&apos;t empty alone.</Accent></>}
        lede="Each agent gets a Safe smart account with three owners: the agent's key, Palisec's co-signer and your recovery wallet. Any transaction needs two of them."
      />

      <Split
        left={<div className="space-y-4"><Label>Three owners</Label><p className="t-h3">Two signatures for anything to move.</p></div>}
        right={
          <div>
            <Rows>
              {OWNERS.map((o) => (
                <li key={o.who} className="grid gap-2 py-6 sm:grid-cols-[13.75rem_1fr_auto] sm:items-baseline sm:gap-6">
                  <span className={`font-utility text-[1.0625rem] font-medium ${o.accent ? "text-aqua" : "text-mist"}`}>{o.who}</span>
                  <span className="t-body">{o.what}</span>
                  <span className="font-mono text-[0.8125rem] text-dim">→ {o.when}</span>
                </li>
              ))}
            </Rows>
            <p className="mt-6 font-mono text-[0.8125rem] text-dim">Threshold 2 of 3 · Safe smart account · ERC-4337</p>
          </div>
        }
      />

      <Split
        left={<div className="space-y-4"><Label>What changes for the agent</Label><p className="t-h3">Free to act. Not free to drain.</p></div>}
        right={
          <div className="grid gap-10 md:grid-cols-2">
            <div>
              <p className="t-label mb-4 !text-allow">The agent can</p>
              <Rows>
                {["Propose any transaction", "Spend within its limits", "Get a decision in milliseconds", "See why anything was blocked"].map((t) => (
                  <li key={t} className="py-4 t-body">{t}</li>
                ))}
              </Rows>
            </div>
            <div>
              <p className="t-label mb-4 !text-deny">The agent can&apos;t</p>
              <Rows>
                {["Move funds without the co-signer", "Raise its own limits", "Lift a stop the account engaged", "Skip the loosening delay"].map((t) => (
                  <li key={t} className="py-4 t-body">{t}</li>
                ))}
              </Rows>
            </div>
          </div>
        }
      />

      <Split
        id="stop"
        left={<div className="space-y-4"><Label>Emergency stop</Label><p className="t-h3">One switch. Every decision stops.</p></div>}
        right={
          <div className="space-y-6">
            <div className="flex items-center gap-4" aria-hidden>
              <span className="relative inline-flex h-8 w-14 items-center rounded-full border border-deny/60 bg-deny/15">
                <span className="absolute right-1 h-6 w-6 rounded-full bg-deny" />
              </span>
              <Result kind="blocked">Stopped</Result>
            </div>
            <p className="t-body">
              Anyone you allow can engage the stop. Once the account itself engages it on the ERC-8511 registry, only the account can lift it. Palisec stops deciding too:
              every request returns <span className="font-mono text-aqua">PS_PAUSED_001</span>, and if the stop state can&apos;t be read,{" "}
              <span className="font-mono text-aqua">PS_STATE_001</span>.
            </p>
          </div>
        }
      />

      <Split
        left={<div className="space-y-4"><Label>Deployed on mainnet</Label><p className="t-h3">Robinhood Chain 4663.</p></div>}
        right={
          <div className="space-y-8">
            <Rows>
              {DEPLOYED.map((c) => (
                <li key={c.address} className="grid gap-1 py-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6">
                  <span className="text-[1rem] text-mist">{c.name}</span>
                  <a href={`${EXPLORER}/address/${c.address}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[0.875rem] text-silver hover:text-aqua">
                    {short(c.address)} ↗
                  </a>
                </li>
              ))}
            </Rows>
            <p className="t-body text-silver">
              On the roadmap: signing inside a hardware enclave. Today the co-signer key is held server-side, one per network, and it can never move funds alone.
            </p>
          </div>
        }
      />

      <Split
        left={<Label>Enforced by the account</Label>}
        right={
          <p className="t-body">
            A gateway cannot guard a key it does not hold. The protected path is the smart account itself: its threshold is 2 and Palisec&apos;s co-signer is one of the
            owners, so a transaction Palisec did not authorize cannot execute, whatever the agent&apos;s software does. The Safe executes exactly the evaluated target,
            value and calldata.
          </p>
        }
      />
    </>
  );
}
