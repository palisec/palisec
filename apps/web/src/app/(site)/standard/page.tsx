import type { Metadata } from "next";
import manifest from "../../../../../../deployments/robinhood-mainnet.json";
import { pageOpenGraph } from "@/lib/seo";
import { NETWORKS, MAINNET } from "@/lib/networks";
import { CodeBlock } from "@/components/copy-button";
import { Accent, Label, LineButton, Rows } from "@/components/line/parts";
import { PageHead, Split } from "@/components/line/split";

export const metadata: Metadata = {
  title: "ERC-8511",
  description: "ERC-8511 lets anyone check, from the chain alone, which policy an agent account runs and whether it is stopped. No API, no need to trust Palisec.",
  alternates: { canonical: "/standard" },
  openGraph: pageOpenGraph("/standard"),
};

const EXPLORER = NETWORKS[MAINNET].explorer;
const LOSS_DEMO = "0x667729a0E035332F63e69626CD7A97863C49fD77";

const DEFINES = [
  ["01", "Which policy", "An account's active policy hash and version, on chain."],
  ["02", "When it changes", "A minimum delay before any loosening takes effect."],
  ["03", "Whether it's stopped", "A stop the account engaged, which only the account can lift."],
];

const REGISTRIES = manifest.palisec_deployed_contracts.filter((c) => c.name.startsWith("Policy registry"));

const READ = `import { createPublicClient, http } from "viem";
import { REGISTRY_ADDRESSES, readAccount } from "policy-enforced-accounts";

const client = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });
const s = await readAccount(client, "${LOSS_DEMO}", REGISTRY_ADDRESSES[4663]);
console.log(s.policy?.policyHash, s.policy?.version, s.stopped, s.stopHeldByAccount);`;

export default function StandardLinePage() {
  return (
    <>
      <PageHead
        label="ERC-8511"
        title={<>An open standard for <Accent>policy-enforced agent accounts.</Accent></>}
        lede="ERC-8511 lets anyone check, from the chain alone, which policy an agent account runs and whether it's stopped. No API, no need to trust Palisec."
      />

      <Split
        left={<Label>What it defines</Label>}
        right={
          <div className="grid gap-10 md:grid-cols-3">
            {DEFINES.map(([n, t, b]) => (
              <div key={n} className="space-y-3 border-t border-line pt-5">
                <p className="font-mono text-[13px] text-dim">{n}</p>
                <p className="t-h3">{t}</p>
                <p className="t-body text-silver">{b}</p>
              </div>
            ))}
          </div>
        }
      />

      <Split
        left={<Label>The registry</Label>}
        right={
          <div className="space-y-5">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] font-mono text-[14.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-[0.14em] text-dim">
                    <th className="py-3 pr-4 font-normal">Version</th>
                    <th className="py-3 pr-4 font-normal">Address</th>
                    <th className="py-3 font-normal">State</th>
                  </tr>
                </thead>
                <tbody>
                  {REGISTRIES.map((r, i) => (
                    <tr key={r.address} className="border-b border-line">
                      <td className="py-4 pr-4 text-mist">{["v3", "v2", "v1"][i]}</td>
                      <td className="py-4 pr-4">
                        <a href={`${EXPLORER}/address/${r.address}`} target="_blank" rel="noopener noreferrer" className={`break-all hover:text-aqua ${i === 0 ? "text-foam" : "text-silver"}`}>
                          {r.address} ↗
                        </a>
                      </td>
                      <td className={`py-4 ${i === 0 ? "text-allow" : "text-dim"}`}>{i === 0 ? "current" : "superseded"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="font-mono text-[13px] text-dim">ERC-165 interface 0xf594edcd · Robinhood Chain 4663</p>
          </div>
        }
      />

      <Split
        left={<div className="space-y-4"><Label>Read it yourself</Label><p className="t-body text-silver">The loss-limits demo account on registry v3.</p></div>}
        right={
          <div>
            <CodeBlock code="npm i policy-enforced-accounts viem" title="terminal" />
            <CodeBlock code={READ} title="read.ts" />
          </div>
        }
      />

      <Split
        left={<Label>Follow the standard</Label>}
        right={
          <Rows>
            <li className="py-5"><LineButton href="https://github.com/ethereum/ERCs/pull/2196" variant="ghost">The ERC pull request ↗</LineButton></li>
            <li className="py-5"><LineButton href="https://ethereum-magicians.org/t/erc-8511-policy-enforced-agent-accounts/30467" variant="ghost">Ethereum Magicians discussion ↗</LineButton></li>
            <li className="py-5"><LineButton href="/docs/standard" variant="ghost">The standard in the docs →</LineButton></li>
          </Rows>
        }
      />
    </>
  );
}
