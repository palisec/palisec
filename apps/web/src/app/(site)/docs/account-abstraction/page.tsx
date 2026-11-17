import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";
import { AgentIcon, CheckCircleIcon, HandIcon, KeyIcon, ShieldIcon, UserCheckIcon } from "@/components/icons";
import { Note } from "@/components/ui";
import { SAFE_4337 } from "@/lib/safe-op";

export const metadata: Metadata = {
  title: "Smart accounts",
  description: "On-chain enforcement with a PALISEC smart account: a Safe with the 4337 module whose threshold is 2 and whose owners include PALISEC's co-signer.",
  alternates: { canonical: "/docs/account-abstraction" },
};

const TS = `import { createPalisec } from "@palisec/sdk";
import { privateKeyToAccount } from "viem/accounts";

const palisec = createPalisec({ apiKey: process.env.PALISEC_API_KEY! });
const agentKey = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as \`0x\${string}\`);

const { operation, execution } = await palisec.executeWithSmartAccount(agentKey, {
  to: TOKEN,
  data: transferCalldata,
  gasLimit: 200_000,
});
// execution.status: "executed" | "reverted" | "submitted"; execution.transactionHash once included`;

const PY = `from eth_account import Account
from palisec import Palisec

agent = Account.from_key(os.environ["AGENT_PRIVATE_KEY"])
sign = lambda td: agent.sign_typed_data(full_message=td).signature.hex()

async with Palisec(api_key=os.environ["PALISEC_API_KEY"]) as client:
    result = await client.execute_with_smart_account(sign, to=TOKEN, data=transfer_calldata, gas=200_000)
    print(result["execution"]["status"], result["execution"].get("transaction_hash"))`;

const HTTP = `POST /v1/operations                     → ALLOW (or approved later)
POST /v1/operations/{id}/user-operation  → { typed_data, safe_op_hash, user_operation, max_cost_wei }
   the agent signs typed_data (EIP-712) with its own key
POST /v1/operations/{id}/submit          { "signature": "0x…" }  → 202 { user_op_hash }
GET  /v1/operations/{id}/execution       → { status: "executed", transaction_hash }`;

const OWNERS = [
  { icon: <AgentIcon size={18} />, who: "Agent key", why: "Signs every operation the agent wants. Alone it moves nothing." },
  { icon: <ShieldIcon size={18} />, who: "PALISEC co-signer", why: "Signs only an operation PALISEC allowed or a person approved, once, for that payload, until it expires." },
  { icon: <UserCheckIcon size={18} />, who: "Recovery owner", why: "Your organization's wallet. With either other key it can move funds, so nothing is stuck if PALISEC is unavailable." },
];

const GUARANTEES = [
  "The Safe executes exactly the evaluated target, value and calldata, as a plain call. PALISEC never builds a delegate call.",
  "The co-signature is bound to the Safe, nonce, call, gas limits, fees, EntryPoint and chain. Change any of them and it is invalid.",
  "validUntil is the authorization's expiry. After it, the Safe rejects the operation on chain.",
  "Each operation is co-signed at most once. The claim and its audit event are one database statement.",
  "The agent's signature must recover to an owner other than PALISEC, and the account is read from chain before co-signing.",
  "The bundler key and the co-signing key stay on the server. Health reports only whether they are configured.",
];

export default function SmartAccounts() {
  return (
    <DocArticle
      title="Smart accounts"
      lede="On-chain enforcement: the agent's funds live in a Safe that needs PALISEC's co-signature, so a stolen agent key cannot move them."
      maturity="service"
      compat={`Mainnet 4663 · Testnet 46630 · Safe 1.4.1 · Safe 4337 module v0.3.0 · EntryPoint v0.7`}
    >
      <h2 id="model">How it works</h2>
      <p>
        A PALISEC smart account is a standard, audited <strong>Safe</strong> with the <strong>Safe 4337 module</strong>. It has three
        owners and needs two signatures:
      </p>
      <ul className="not-prose my-6 space-y-3">
        {OWNERS.map((o) => (
          <li key={o.who} className="flex gap-3 rounded-[12px] border border-line-strong bg-deep/60 p-4">
            <span aria-hidden className="mt-0.5 text-aqua">{o.icon}</span>
            <span>
              <span className="block text-[15px] font-medium text-mist">{o.who}</span>
              <span className="mt-0.5 block text-[14px] text-silver">{o.why}</span>
            </span>
          </li>
        ))}
      </ul>
      <p>
        No new contract is involved: the Safe&apos;s own threshold is the enforcement. PALISEC adds its signature after its
        deterministic decision; the Safe checks both signatures on chain.
      </p>

      <h2 id="create">Create one</h2>
      <ol>
        <li>In the console, open <Link href="/console/smart-accounts">Smart accounts</Link>.</li>
        <li>Enter the address of the key your agent signs with, and a recovery owner (your wallet is one click).</li>
        <li>Choose the network in the console&apos;s top bar: <strong>Mainnet</strong> (real funds) or <strong>Testnet</strong>.</li>
        <li><strong>Create with my wallet</strong>: your wallet sends one transaction to the Safe factory on that network.</li>
        <li>Send the new account a little ETH; it pays its own gas. On mainnet, start with a small amount.</li>
        <li>Register the agent with the new address as its account, and point its policy at the same address.</li>
      </ol>

      <h2 id="execute">Execute through it</h2>
      <CodeBlock code={TS} title="agent.ts" />
      <CodeBlock code={PY} title="agent.py" />
      <p>Or over HTTP, in four calls:</p>
      <CodeBlock code={HTTP} title="flow" />

      <h2 id="guarantees">What is guaranteed</h2>
      <ul className="not-prose my-6 space-y-2.5">
        {GUARANTEES.map((g) => (
          <li key={g} className="flex gap-3 text-[14.5px] leading-relaxed text-silver">
            <CheckCircleIcon size={17} className="mt-0.5 shrink-0 text-allow" />
            {g}
          </li>
        ))}
      </ul>

      <h2 id="approvals">With human approval</h2>
      <p className="flex items-start gap-2">
        <HandIcon size={17} className="mt-1 shrink-0 text-review" />
        <span>
          An operation above the approval threshold waits. Once a person approves it in the console, it becomes executable like an
          allowed one; <code>executeWithSmartAccount</code> waits for that when you pass <code>waitForApproval: true</code>.
        </span>
      </p>

      <h2 id="contracts">Contracts on Robinhood Chain</h2>
      <p>
        The same contracts, with byte-for-byte identical code, are deployed at the same addresses on mainnet (4663) and
        testnet (46630). PALISEC co-signs with a different key on each network, and the signed data names the network, so a
        signature made for one can never be used on the other.
      </p>
      <table>
        <thead><tr><th>Contract</th><th>Address</th></tr></thead>
        <tbody>
          <tr><td>EntryPoint v0.7</td><td><code>{SAFE_4337.entryPoint}</code></td></tr>
          <tr><td>Safe 4337 module v0.3.0</td><td><code>{SAFE_4337.module}</code></td></tr>
          <tr><td>Safe module setup</td><td><code>{SAFE_4337.moduleSetup}</code></td></tr>
          <tr><td>Safe 1.4.1 singleton</td><td><code>{SAFE_4337.singleton}</code></td></tr>
          <tr><td>Safe proxy factory</td><td><code>{SAFE_4337.proxyFactory}</code></td></tr>
        </tbody>
      </table>

      <h2 id="limits">Security model and limits</h2>
      <Note kind="warning" title="Server-held co-signer">
        <span className="inline-flex items-start gap-2">
          <KeyIcon size={16} className="mt-0.5 shrink-0" />
          <span>
            PALISEC&apos;s co-signing keys (one per network) are held by the server. The co-signer cannot move funds alone, but a
            compromise of the server together with an agent&apos;s key could co-sign outside policy, so keep mainnet balances
            modest until signing moves into the attested enclave (<Link href="/attestation">attestation</Link>). Agents that send
            from a plain key are not enforced on chain; only smart accounts are.
          </span>
        </span>
      </Note>
    </DocArticle>
  );
}
