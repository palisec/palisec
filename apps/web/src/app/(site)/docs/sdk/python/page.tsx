import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import Link from "next/link";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";
import { Note } from "@/components/ui";
import { PY_WHEEL, SCHEMA_LABEL, VERSIONS } from "@/lib/versions";

export const metadata: Metadata = {
  title: "Python SDK",
  description: "palisec for Python: async, typed, no dependencies. Ask Palisec before every agent transaction and send only on ALLOW.",
  alternates: { canonical: "/docs/sdk/python" }, openGraph: pageOpenGraph("/docs/sdk/python"),
};

const INSTALL = `pip install palisec
# optional, to send with web3.py:
pip install web3

# Alternative, straight from palisec.tech:
# pip install ${PY_WHEEL}`;

const SEND = `import os
from web3 import AsyncWeb3, AsyncHTTPProvider
from eth_account import Account
from palisec import Palisec, PalisecDeniedError
from palisec.web3 import Web3Sender

# The agent's own account: the one you registered in Console → Agents.
w3 = AsyncWeb3(AsyncHTTPProvider("https://rpc.mainnet.chain.robinhood.com"))  # testnet: rpc.testnet.chain.robinhood.com
sender = Web3Sender(w3, Account.from_key(os.environ["AGENT_KEY"]))

async with Palisec(os.environ["PALISEC_API_KEY"]) as palisec:   # server-side only
    try:
        result = await palisec.send_transaction(
            sender, to=TOKEN, data=transfer_calldata, gas_limit=90_000,
        )
        if result.hash:
            print("sent", result.hash, "under", result.operation.authorization_id)
        else:
            print("held for a human approver:", result.operation.operation_id)
    except PalisecDeniedError as e:
        print(e.code, e.message)                                  # nothing was sent`;

const DECISIONS = `op = await palisec.authorize(to=TOKEN, data=calldata, gas_limit=90_000)

match op.decision:
    case "ALLOW":                       # op.authorization_id, op.expires_at (5 minutes)
        ...
    case "REQUIRES_HUMAN_SIGNATURE":    # op.operation_id; nothing is authorized yet
        approved = await palisec.wait_for_approval(op.operation_id, timeout=900)
    case "DENY":                        # op.reason_code, op.message; never send it
        ...`;

const ERRORS = `from palisec import PalisecError, PalisecTimeoutError, Intent

intent = Intent(to=TOKEN, data=calldata, gas_limit=90_000, request_id=str(uuid4()))
try:
    op = await palisec.authorize(intent)
except PalisecTimeoutError:
    op = await palisec.authorize(intent)   # same request ID, so this returns the original decision
except PalisecError as e:
    log.error("palisec %s %s %s", e.code, e.status, e.request_id)   # e.g. PS_AUTH_001, PS_RATE_001`;

const CONFIG = `Palisec(
    os.environ["PALISEC_API_KEY"],      # ps_test_… ; validated on construction
    # chain_id is optional: a ps_live_ key is mainnet (4663), a ps_test_ key is testnet (46630)
    base_url="https://palisec.tech/api/v1",
    timeout=15.0,                       # seconds, per request
    max_retries=2,                      # network errors, 429 and 5xx, on safe calls only
    logger=lambda event: log.debug(event),   # never includes the key, bodies or calldata
)`;

const TOOL = `# One tool for any framework (LangChain, CrewAI, your own loop). The framework decides
# what to try; Palisec decides whether it may be sent. No security logic lives here.
async def send_token(to: str, amount: int) -> str:
    """Send \`amount\` base units of TOKEN to \`to\`."""
    try:
        r = await palisec.send_transaction(sender, to=TOKEN, data=erc20_transfer(to, amount), gas_limit=90_000)
    except PalisecDeniedError as e:
        return f"Refused by policy ({e.code}): {e.message}"
    return f"Sent: {r.hash}" if r.hash else f"Waiting for human approval: {r.operation.operation_id}"

# LangChain:  from langchain_core.tools import tool;  send_token_tool = tool(send_token)`;

export default function PythonSdk() {
  return (
    <DocArticle
      title="Python SDK"
      lede="palisec asks Palisec before every transaction and sends with your account only on ALLOW. Async, typed, and no third-party dependencies. It holds no security logic of its own: every decision is made and recorded server-side."
      maturity="service"
      compat={`palisec ${VERSIONS.sdkPy} · Python 3.10+ · ${SCHEMA_LABEL} · mainnet 4663 · testnet 46630`}
    >
      <Note kind="warning" title="What the SDK enforces">
        <code>send_transaction</code> refuses to send a denied or unapproved transaction from your process, but a plain key used elsewhere can
        still transact. <code>execute_with_smart_account</code> is enforced on chain: the agent&apos;s 
        <Link href="/docs/account-abstraction">Palisec smart account</Link> moves nothing without Palisec&apos;s co-signature.
      </Note>

      <h2 id="install">Install</h2>
      <p>Published on PyPI as <code>palisec</code> and also served from palisec.tech. It has the same semantics as the <Link href="/docs/sdk/typescript">TypeScript SDK</Link> and is tested against the live API on every change.</p>
      <CodeBlock code={INSTALL} title="terminal" />
      <p>
        You need an agent API key: sign in, create and activate a policy, register the agent and create a key (see the{" "}
        <Link href="/docs/quickstart">quickstart</Link>).
      </p>

      <h2 id="send">Send only on ALLOW</h2>
      <CodeBlock code={SEND} title="agent.py" />
      <ul>
        <li>The sender must be the agent&apos;s registered account, or the SDK refuses before sending.</li>
        <li><code>Web3Sender</code> checks the RPC is on the authorized chain, signs locally and pays the RPC&apos;s current gas price with the gas limit Palisec bounded the fee on. It works with <code>Web3</code> or <code>AsyncWeb3</code>.</li>
        <li>Any object with an <code>address</code> and a <code>send_transaction(tx)</code> method can be a sender.</li>
        <li>Pass <code>wait_for_approval=True</code> to wait for an approver and then send; by default a held operation is returned unsent.</li>
      </ul>

      <h2 id="decisions">Decisions</h2>
      <p>
        <code>authorize</code> records the decision and its budget reservation and returns it; it does not raise on DENY.{" "}
        <code>evaluate</code> is the same check as a dry run that reserves nothing. Both take keyword arguments or an <code>Intent</code>.
      </p>
      <CodeBlock code={DECISIONS} title="decisions.py" />

      <h2 id="errors">Errors and retries</h2>
      <p>
        Every failure is a <code>PalisecError</code> with a stable <code>code</code>: the <Link href="/docs/errors">reason codes</Link> plus{" "}
        <code>PS_SDK_CONFIG</code>, <code>PS_SDK_TIMEOUT</code> and <code>PS_SDK_NETWORK</code>. Subclasses: <code>PalisecDeniedError</code>,{" "}
        <code>PalisecApprovalError</code> (rejected, expired or withdrawn), <code>PalisecTimeoutError</code>, <code>PalisecConfigError</code>.
      </p>
      <CodeBlock code={ERRORS} title="errors.py" />
      <p>
        Retries are automatic only where they are provably safe: authorizations carry the request ID as an idempotency key, dry runs and reads
        change nothing. <code>cancel</code> is never retried. Redirects are never followed, so your key cannot be forwarded to another host.
      </p>

      <h2 id="frameworks">Agent frameworks</h2>
      <p>Wrap <code>send_transaction</code> as a tool. Every framework calls the same protected path, so there is nothing framework-specific to secure.</p>
      <CodeBlock code={TOOL} title="tools.py" />

      <h2 id="config">Configuration</h2>
      <CodeBlock code={CONFIG} title="config.py" />
      <p>
        Without a <code>logger</code>, events go to the standard <code>logging</code> logger named <code>palisec</code> at DEBUG level. To use
        your own HTTP stack, pass <code>transport</code>: an async callable that takes the method, URL, headers, body and timeout and returns
        the status and text.
      </p>

      <h2 id="reference">Reference</h2>
      <ul>
        <li><code>authorize(intent | **fields)</code>: record a decision. Fields: <code>to</code>, <code>value</code> (int wei), <code>data</code>, <code>gas_limit</code>, <code>request_id</code>, <code>deadline_seconds</code>.</li>
        <li><code>evaluate(...)</code>: dry run.</li>
        <li><code>send_transaction(sender, ..., wait_for_approval=False, approval_timeout=900)</code>: authorize, then send only if allowed.</li>
        <li><code>get_operation(id)</code>, <code>wait_for_approval(id, timeout=900, interval=5)</code>, <code>cancel(id)</code>.</li>
        <li><code>Operation</code> (frozen dataclass, <code>.allowed</code>), <code>redact(text)</code>, <code>REASON_CODES</code>, <code>RETRYABLE</code>.</li>
      </ul>
    </DocArticle>
  );
}
