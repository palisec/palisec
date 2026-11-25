"use client";

import { useState } from "react";
import { encodeFunctionData, formatUnits, getAddress, parseAbi, type Address, type Hex } from "viem";
import { BILLING, TOKEN, usdE6 } from "@/lib/billing-config";
import { connectAs } from "@/lib/browser-wallet";
import { walletChainParams } from "@/lib/networks";
import { shortHex } from "@/lib/units";
import { Btn, Empty, KV, Mono, Notice, PageTitle, Panel, Pill } from "../kit";
import { LoadError, Loading, thCls, useAction, utc } from "./common";
import { useConsoleSession, useLive } from "./session";

interface Summary {
  month: string;
  metering: boolean;
  free: number;
  used: number;
  credits: number;
  warning: string | null;
  purchase_account: Hex;
  price: { usd_micros_per_thousand: number; palisec_discount_bps: number; packs: number[] };
  contract: { chain_id: number; address: Address | null; usdg: Address; palisec: Address; explorer: string };
  sync_error: string | null;
  pro: { active: boolean; balance: string | null; required: string; checked_at: string | null };
  limits: { agents: number; policies: number; auditDays: number; apiRequestsPerMinute: number; agentRequestsPerDay: number };
  plans: { normal: Summary["limits"]; pro: Summary["limits"] };
  history: { kind: string; credits: string; asset: string | null; amount_paid: string | null; usd_micros: string | null; burned: string | null; tx_hash: string | null; created_at: string }[];
}

const CREDITS_ABI = parseAbi([
  "function buyWithUsdg(bytes32 account, uint256 credits)",
  "function buyWithEth(bytes32 account, uint256 credits) payable",
  "function quoteWei(uint256 credits) view returns (uint256)",
]);
const ERC20_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)", "function allowance(address owner, address spender) view returns (uint256)"]);

const tokens = (wei: string | null) => (wei ? Number(formatUnits(BigInt(wei), 18)).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "0");

/** Billing: metered mainnet decisions, prepaid credits bought on chain, and Pro by holdings. */
export function LiveBilling() {
  const { me } = useConsoleSession();
  const { data, error, reload } = useLive<Summary>("/billing");
  const act = useAction();
  const [pack, setPack] = useState<number>(BILLING.packs[0]);

  if (error) return <LoadError error={error} />;
  if (!data) return <Loading what="billing" />;

  const usedShare = Math.min(data.used / data.free, 1);
  const usd = Math.ceil((pack * data.price.usd_micros_per_thousand) / 1000);
  const contract = data.contract.address;

  async function walletOn(): Promise<{ eth: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }; from: Address }> {
    if (!me?.address) throw new Error("Sign in first.");
    const params = walletChainParams(TOKEN.chainId);
    const { eth, from } = await connectAs(me.address);
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: params.chainId }] });
    } catch (e) {
      if ((e as { code?: number }).code !== 4902) throw e;
      await eth.request({ method: "wallet_addEthereumChain", params: [params] });
    }
    const now = (await eth.request({ method: "eth_chainId" })) as string;
    if (Number(now) !== TOKEN.chainId) throw new Error("Switch your wallet to Robinhood Chain mainnet and try again.");
    return { eth, from: getAddress(from) };
  }

  async function waitFor(eth: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }, tx: Hex) {
    for (let i = 0; i < 60; i++) {
      const r = (await eth.request({ method: "eth_getTransactionReceipt", params: [tx] })) as { status?: string } | null;
      if (r?.status) {
        if (r.status !== "0x1") throw new Error("The transaction reverted. Nothing was charged.");
        return;
      }
      await new Promise((res) => setTimeout(res, 2000));
    }
    throw new Error("No receipt after two minutes. Check the transaction in your wallet; credits appear once it is confirmed.");
  }

  function buyUsdg() {
    act.run(async () => {
      if (!contract) throw new Error("Buying credits is not available on this deployment yet.");
      const { eth, from } = await walletOn();
      const allowance = (await eth.request({
        method: "eth_call",
        params: [{ to: TOKEN.usdg, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "allowance", args: [from, contract] }) }, "latest"],
      })) as Hex;
      if (BigInt(allowance) < BigInt(usd)) {
        const approve = (await eth.request({ method: "eth_sendTransaction", params: [{ from, to: TOKEN.usdg, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [contract, BigInt(usd)] }) }] })) as Hex;
        await waitFor(eth, approve);
      }
      const tx = (await eth.request({ method: "eth_sendTransaction", params: [{ from, to: contract, data: encodeFunctionData({ abi: CREDITS_ABI, functionName: "buyWithUsdg", args: [data!.purchase_account, BigInt(pack)] }) }] })) as Hex;
      await waitFor(eth, tx);
      setTimeout(reload, 4000);
      return tx;
    }, (tx) => `Paid ${usdE6(usd)} in USDG (${shortHex(tx)}). Credits appear after a few confirmations.`);
  }

  function buyEth() {
    act.run(async () => {
      if (!contract) throw new Error("Buying credits is not available on this deployment yet.");
      const { eth, from } = await walletOn();
      const quote = BigInt((await eth.request({ method: "eth_call", params: [{ to: contract, data: encodeFunctionData({ abi: CREDITS_ABI, functionName: "quoteWei", args: [BigInt(pack)] }) }, "latest"] })) as Hex);
      // 1% headroom for an ETH/USD update between the quote and the transaction; the contract refunds the rest.
      const value = quote + quote / 100n;
      const tx = (await eth.request({
        method: "eth_sendTransaction",
        params: [{ from, to: contract, value: `0x${value.toString(16)}`, data: encodeFunctionData({ abi: CREDITS_ABI, functionName: "buyWithEth", args: [data!.purchase_account, BigInt(pack)] }) }],
      })) as Hex;
      await waitFor(eth, tx);
      setTimeout(reload, 4000);
      return tx;
    }, (tx) => `Paid in ETH (${shortHex(tx)}). Credits appear after a few confirmations.`);
  }

  return (
    <div className="space-y-5">
      <PageTitle title="Billing" description="Mainnet decisions are free up to the monthly allowance, then use prepaid credits. Testnet and dry runs are always free." />
      {data.warning && <Notice tone={data.credits === 0 && data.used >= data.free ? "deny" : "review"}>{data.warning}</Notice>}
      {data.sync_error && <Notice>{data.sync_error}</Notice>}

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title={`Usage · ${data.month}`} bodyClassName="p-4 space-y-3">
          <p className="font-heading text-[28px] font-bold leading-none text-phosphor">{data.used.toLocaleString("en-US")}<span className="text-[15px] text-muted"> / {data.free.toLocaleString("en-US")} free</span></p>
          <div className="h-2 overflow-hidden rounded-full bg-raised" role="meter" aria-valuemin={0} aria-valuemax={data.free} aria-valuenow={data.used} aria-label="Free mainnet decisions used">
            <div className={`h-full ${usedShare >= 0.95 ? "bg-deny" : usedShare >= 0.8 ? "bg-review" : "bg-aqua"}`} style={{ width: `${usedShare * 100}%` }} />
          </div>
          <p className="text-[12.5px] text-muted">Past the allowance, each mainnet decision uses one credit. With none left, requests are refused with <Mono>402 PS_CREDIT_001</Mono>: nothing is authorized, so nothing can move.</p>
        </Panel>
        <Panel title="Credits" bodyClassName="p-4 space-y-3">
          <p className="font-heading text-[28px] font-bold leading-none text-phosphor">{data.credits.toLocaleString("en-US")}</p>
          <p className="text-[12.5px] text-muted">{usdE6(data.price.usd_micros_per_thousand)} per 1,000 decisions. Credits do not expire.</p>
        </Panel>
        <Panel title="Plan" actions={<Pill tone={data.pro.active ? "allow" : "muted"}>{data.pro.active ? "Pro" : "Standard"}</Pill>} bodyClassName="p-4 space-y-3">
          <p className="text-[13px] text-soft">
            Pro when an owner wallet holds at least <Mono>{tokens(data.pro.required)}</Mono> $PALISEC. Nothing is locked or sent; the balance is read from the chain.
          </p>
          <KV rows={[["Owner balance", `${tokens(data.pro.balance)} Palisec`], ["Checked", data.pro.checked_at ? utc(data.pro.checked_at) : "—"]]} />
        </Panel>
      </div>

      <Panel title="Buy credits" bodyClassName="p-4 space-y-4">
        <div role="radiogroup" aria-label="Credit pack" className="flex flex-wrap gap-2">
          {data.price.packs.map((p) => (
            <label key={p} className={`cursor-pointer rounded-[6px] border px-3 py-2 text-[13px] ${pack === p ? "border-aqua/60 bg-raised text-mist" : "border-line text-soft hover:bg-raised/60"}`}>
              <input type="radio" className="sr-only" checked={pack === p} onChange={() => setPack(p)} />
              {p.toLocaleString("en-US")} credits · {usdE6(Math.ceil((p * data.price.usd_micros_per_thousand) / 1000))}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn variant="primary" disabled={act.busy || !contract} onClick={buyUsdg}>Pay {usdE6(usd)} in USDG</Btn>
          <Btn disabled={act.busy || !contract} onClick={buyEth}>Pay in ETH</Btn>
          <Btn disabled title={`Paying in $PALISEC (${data.price.palisec_discount_bps / 100}% off, tokens burned) opens once a time-weighted price is available.`}>
            Pay in $PALISEC · {data.price.palisec_discount_bps / 100}% off
          </Btn>
        </div>
        {!contract && <p className="text-[12.5px] text-muted">Buying credits is not available on this deployment yet.</p>}
        {act.notice}
        <p className="text-[12px] text-muted">
          Payments go to the credits contract on Robinhood Chain mainnet{contract ? <> (<a className="underline" href={`${data.contract.explorer}/address/${contract}`} target="_blank" rel="noreferrer">{shortHex(contract)}</a>)</> : null}, which forwards USDG and ETH in the same transaction. Purchase account <Mono>{shortHex(data.purchase_account)}</Mono>.
        </p>
      </Panel>

      <Panel title="Limits" bodyClassName="p-0">
        <table className="w-full text-[13px]">
          <thead className="text-left">
            <tr>{["", "Standard", "Pro", "Yours"].map((h) => <th key={h} className={thCls}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {([
              ["Agents", "agents"],
              ["Active policies", "policies"],
              ["Audit history (days)", "auditDays"],
              ["API requests per minute, per key", "apiRequestsPerMinute"],
              ["Palisec Agent requests per day", "agentRequestsPerDay"],
            ] as const).map(([label, k]) => (
              <tr key={k} className="border-b border-line last:border-b-0">
                <td className="px-4 py-2 text-soft">{label}</td>
                <td className="px-4 py-2 font-mono text-[12px] text-muted">{data.plans.normal[k]}</td>
                <td className="px-4 py-2 font-mono text-[12px] text-muted">{data.plans.pro[k]}</td>
                <td className="px-4 py-2 font-mono text-[12px] text-mist">{data.limits[k]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Purchase history" bodyClassName="p-0">
        {data.history.length === 0 ? (
          <Empty title="No purchases yet" />
        ) : (
          <table className="w-full text-[13px]">
            <thead className="text-left">
              <tr>{["Time (UTC)", "Credits", "Paid", "Burned", "Transaction"].map((h) => <th key={h} className={thCls}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {data.history.map((h, i) => (
                <tr key={`${h.tx_hash}-${i}`} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2 font-mono text-[11.5px] text-muted">{utc(h.created_at).slice(0, 19)}</td>
                  <td className="px-4 py-2 text-soft">+{Number(h.credits).toLocaleString("en-US")}</td>
                  <td className="px-4 py-2 text-soft">{h.usd_micros ? `${usdE6(Number(h.usd_micros))} in ${h.asset}` : h.kind}</td>
                  <td className="px-4 py-2 text-soft">{h.burned && h.burned !== "0" ? `${tokens(h.burned)} Palisec` : "—"}</td>
                  <td className="px-4 py-2">{h.tx_hash ? <a className="font-mono text-[12px] underline" href={`${data.contract.explorer}/tx/${h.tx_hash}`} target="_blank" rel="noreferrer">{shortHex(h.tx_hash)}</a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
