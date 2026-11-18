"use client";

import { useState } from "react";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { explorerAddress, network as networkOf, networkLabel, walletChainParams, type NetworkId } from "@/lib/networks";
import { createSafeCalldata, SAFE_4337 } from "@/lib/safe-op";
import { connectAs, type Eip1193 } from "@/lib/browser-wallet";
import { shortHex } from "@/lib/units";
import { Btn, Empty, Field, inputCls, KV, Mono, Notice, PageTitle, Panel, Pill } from "../kit";
import { LoadError, Loading, thCls, useAction } from "./common";
import { ExecutionDownNotice, useHealth } from "./health";
import { api, can, useConsoleSession, useLive } from "./session";

interface Report {
  chain_id: number;
  address: Address;
  deployed: boolean;
  owners: Address[];
  threshold: number;
  module_enabled: boolean;
  palisec_signer: Address | null;
  palisec_is_owner: boolean;
  enforced: boolean;
  reason: string | null;
}
interface Config {
  chain_id: number;
  palisec_signer: Address | null;
  threshold: number;
  entry_point: Address;
  safe_4337_module: Address;
  safe_proxy_factory: Address;
  submission: "available" | "not_configured";
  agents: { agent_id: string; agent_name: string; agent_status: string; account: Report | null }[];
}

/**
 * Connects the wallet the member signed in with, checks it is on the signed-in account, and moves it
 * to the console's network, adding the network if needed.
 */
async function wallet(chainId: NetworkId, me: string | undefined): Promise<{ eth: Eip1193; from: Address }> {
  if (!me) throw new Error("Sign in first.");
  const params = walletChainParams(chainId);
  const { eth, from } = await connectAs(me);
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: params.chainId }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await eth.request({ method: "wallet_addEthereumChain", params: [params] });
  }
  // Never send on the wrong network: confirm the wallet really moved before anything is signed.
  const now = (await eth.request({ method: "eth_chainId" })) as string;
  if (Number(now) !== chainId) throw new Error(`Your wallet is on chain ${Number(now)}. Switch it to ${networkLabel(chainId)} and try again.`);
  return { eth, from: getAddress(from) };
}

function EnforcedPill({ r }: { r: Report | null }) {
  if (!r) return <Pill tone="muted">Unknown</Pill>;
  return r.enforced ? <Pill tone="allow">Enforced on chain</Pill> : <Pill tone="review">Not enforced</Pill>;
}

/** Smart accounts: create a Safe PALISEC co-signs for, and see which agents are enforced on chain. */
export function LiveSmartAccounts() {
  const { me, org, network } = useConsoleSession();
  const chain = (networkOf(network)?.chainId ?? 46630) as NetworkId;
  const live = networkOf(network)?.testnet === false;
  const cfg = useLive<Config>(`/smart-accounts?chain_id=${chain}`);
  const health = useHealth();
  const act = useAction();
  const [agentKey, setAgentKey] = useState("");
  const [recovery, setRecovery] = useState("");
  const [salt] = useState(() => BigInt(Math.floor(Math.random() * 2 ** 48)));
  const [predicted, setPredicted] = useState<Address | null>(null);
  const [deployed, setDeployed] = useState<{ address: Address; tx: Hex } | null>(null);
  const [lookup, setLookup] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const operate = can.operate(org?.role);
  const signer = cfg.data?.palisec_signer ?? null;

  function owners(): Address[] {
    if (!signer) throw new Error("PALISEC's co-signer is not configured on this deployment.");
    if (!isAddress(agentKey.trim(), { strict: false })) throw new Error("Enter the agent's signing address (0x followed by 40 hex characters).");
    if (!isAddress(recovery.trim(), { strict: false })) throw new Error("Enter a recovery owner, or use your wallet's address.");
    const list = [getAddress(agentKey.trim()), signer, getAddress(recovery.trim())];
    if (new Set(list).size !== 3) throw new Error("The agent key, PALISEC's co-signer and the recovery owner must be three different addresses.");
    return list;
  }

  const predict = () =>
    act.run(async () => {
      const { eth, from } = await wallet(chain, me?.address);
      const data = createSafeCalldata(owners(), salt);
      const out = (await eth.request({ method: "eth_call", params: [{ from, to: SAFE_4337.proxyFactory, data }, "latest"] })) as Hex;
      const address = getAddress(`0x${out.slice(26, 66)}`);
      setPredicted(address);
      return address;
    }, (a) => `The new account will be ${a}.`);

  const deploy = () =>
    act.run(async () => {
      const { eth, from } = await wallet(chain, me?.address);
      const list = owners();
      const data = createSafeCalldata(list, salt);
      const out = (await eth.request({ method: "eth_call", params: [{ from, to: SAFE_4337.proxyFactory, data }, "latest"] })) as Hex;
      const address = getAddress(`0x${out.slice(26, 66)}`);
      const tx = (await eth.request({ method: "eth_sendTransaction", params: [{ from, to: SAFE_4337.proxyFactory, data }] })) as Hex;
      for (let i = 0; i < 60; i++) {
        const r = (await eth.request({ method: "eth_getTransactionReceipt", params: [tx] })) as { status?: string } | null;
        if (r?.status === "0x1") {
          setDeployed({ address, tx });
          setPredicted(address);
          cfg.reload();
          return address;
        }
        if (r?.status === "0x0") throw new Error("The deployment transaction reverted. Nothing was created.");
        await new Promise((res) => setTimeout(res, 2000));
      }
      throw new Error("No receipt after two minutes. Check the transaction in your wallet.");
    }, (a) => `Smart account created at ${a}.`);

  const inspect = () =>
    act.run(async () => {
      const r = await api<Report>(`/smart-accounts/${encodeURIComponent(lookup.trim())}?chain_id=${chain}`);
      setReport(r);
      return r;
    });

  return (
    <>
      <PageTitle
        title="Smart accounts"
        description="A PALISEC smart account is a Safe that needs two signatures: the agent's key and PALISEC's co-signer, which signs only operations PALISEC allowed. Your recovery owner can move funds with either of them."
      />
      <div className="mb-4 empty:hidden"><ExecutionDownNotice h={health} chainId={chain} /></div>
      <LoadError error={cfg.error} />
      {!cfg.data ? (
        <Loading what="smart accounts" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="min-w-0 space-y-4">
            <Panel title="Your agents" bodyClassName="overflow-x-auto">
              {cfg.data.agents.length === 0 ? (
                <Empty title="No agents yet">Register an agent first, then give it a smart account.</Empty>
              ) : (
                <table className="w-full min-w-[560px] text-[13px]">
                  <thead>
                    <tr className="text-left">
                      <th className={thCls}>Agent</th>
                      <th className={thCls}>Account</th>
                      <th className={thCls}>Owners</th>
                      <th className={thCls}>On chain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cfg.data.agents.map((a) => (
                      <tr key={a.agent_id} className="border-b border-line align-top last:border-b-0">
                        <td className="px-4 py-3 text-mist">{a.agent_name}</td>
                        <td className="px-4 py-3"><Mono className="text-soft">{a.account ? shortHex(a.account.address) : "—"}</Mono></td>
                        <td className="px-4 py-3 text-muted">{a.account?.deployed && a.account.owners.length ? `${a.account.threshold} of ${a.account.owners.length}` : "—"}</td>
                        <td className="px-4 py-3">
                          <EnforcedPill r={a.account} />
                          {a.account?.reason && <p className="mt-1 max-w-[34ch] text-[12px] text-muted">{a.account.reason}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Create a smart account" bodyClassName="space-y-4 p-4">
              {!operate ? (
                <p className="text-[13px] text-muted">Creating accounts needs the operator, admin or owner role.</p>
              ) : !signer ? (
                <Notice tone="review">{`PALISEC's co-signer for ${networkLabel(chain)} is not configured on this deployment, so accounts cannot be created there yet.`}</Notice>
              ) : (
                <>
                  {live && <Notice tone="review">Mainnet: this account will hold real funds. Use a recovery owner your organization controls, and start with a small amount.</Notice>}
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field id="sa-agent" label="Agent signing address" hint="The address of the key your agent signs with. Never paste the key itself.">
                      <input id="sa-agent" className={inputCls} value={agentKey} onChange={(e) => setAgentKey(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" />
                    </Field>
                    <Field id="sa-recovery" label="Recovery owner" hint="A wallet your organization controls.">
                      <div className="flex gap-2">
                        <input id="sa-recovery" className={inputCls} value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" />
                        <Btn variant="quiet" onClick={() => me?.address && setRecovery(me.address)}>Mine</Btn>
                      </div>
                    </Field>
                  </div>
                  <KV
                    rows={[
                      ["PALISEC co-signer", <Mono key="s">{signer}</Mono>],
                      ["Threshold", "2 of 3"],
                      ["Network", networkLabel(chain)],
                      ["Predicted address", predicted ? <Mono key="p" className="text-aqua">{predicted}</Mono> : "—"],
                    ]}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Btn variant="quiet" disabled={act.busy} onClick={predict}>Preview address</Btn>
                    <Btn variant="primary" disabled={act.busy} onClick={deploy}>{act.busy ? "Waiting for wallet…" : "Create with my wallet"}</Btn>
                  </div>
                  {act.notice}
                  {deployed && (
                    <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-soft">
                      <li>
                        Send a little {live ? "ETH" : "testnet ETH"} to <Mono>{deployed.address}</Mono>: it pays its own gas.{" "}
                        <a className="text-aqua underline-offset-4 hover:underline" href={explorerAddress(chain, deployed.address) ?? "#"} target="_blank" rel="noopener noreferrer">View on the explorer</a>
                      </li>
                      <li>Register the agent (or a new one) with this address as its account, and point its policy at the same address.</li>
                      <li>In your agent, call <Mono>executeWithSmartAccount</Mono> (TypeScript) or <Mono>execute_with_smart_account</Mono> (Python) with the agent key.</li>
                    </ol>
                  )}
                </>
              )}
            </Panel>
          </div>

          <div className="min-w-0 space-y-4">
            <Panel title={`PALISEC co-signing · ${networkOf(chain)?.short}`} bodyClassName="p-4">
              <KV
                rows={[
                  ["Submission", cfg.data.submission === "available" ? <Pill key="s" tone="allow">Available</Pill> : <Pill key="s" tone="review">Not configured</Pill>],
                  ["Co-signer", signer ? <Mono key="c">{shortHex(signer)}</Mono> : "Not configured"],
                  ["EntryPoint", <Mono key="e">{shortHex(cfg.data.entry_point)}</Mono>],
                  ["Safe 4337 module", <Mono key="m">{shortHex(cfg.data.safe_4337_module)}</Mono>],
                ]}
              />
              <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
                {live
                  ? "Mainnet co-signer: its own key, held by the PALISEC server and never shared with testnet. It holds no funds and cannot move funds alone."
                  : "Testnet co-signer: a key held by the PALISEC server, separate from the mainnet key."}
              </p>
            </Panel>
            <Panel title="Check an account" bodyClassName="space-y-3 p-4">
              <div className="flex gap-2">
                <input className={inputCls} aria-label="Account address" value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="0x…" spellCheck={false} />
                <Btn variant="quiet" disabled={act.busy || !lookup.trim()} onClick={inspect}>Check</Btn>
              </div>
              {report && (
                <div className="space-y-2">
                  <EnforcedPill r={report} />
                  {report.reason && <p className="text-[12.5px] text-muted">{report.reason}</p>}
                  {report.deployed && report.owners.length > 0 && (
                    <KV
                      rows={[
                        ["Threshold", `${report.threshold} of ${report.owners.length}`],
                        ["4337 module", report.module_enabled ? "Enabled" : "Not enabled"],
                        ...report.owners.map((o, i) => [`Owner ${i + 1}`, <Mono key={o}>{o === report.palisec_signer ? `${shortHex(o)} (PALISEC)` : shortHex(o)}</Mono>] as [string, React.ReactNode]),
                      ]}
                    />
                  )}
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
