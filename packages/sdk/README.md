# @palisec/sdk

TypeScript client for [Palisec](https://palisec.tech): your agent asks before every transaction and sends only on ALLOW.

```bash
npm install https://palisec.tech/sdk/palisec-sdk-0.1.0.tgz viem
```

```ts
import { createPalisec, PalisecDeniedError } from "@palisec/sdk";

const palisec = createPalisec({ apiKey: process.env.PALISEC_API_KEY! }); // server-side only

// Let the SDK enforce the decision: it sends with your viem wallet only on ALLOW.
try {
  const { operation, hash } = await palisec.sendTransaction(walletClient, { to: token, data: transferCalldata, gasLimit: 90_000 });
  if (!hash) console.log("Waiting for a human approver:", operation.operationId);
} catch (e) {
  if (e instanceof PalisecDeniedError) console.warn(e.code, e.message); // nothing was sent
  else throw e;
}
```

- `authorize(intent)` records a decision and returns `ALLOW`, `DENY` or `REQUIRES_HUMAN_SIGNATURE`. Safe to retry: the request ID is the idempotency key.
- `evaluate(intent)` is a dry run that reserves nothing.
- `waitForApproval(id)`, `getOperation(id)`, `cancel(id)` (withdraws a pending approval).
- Errors are `PalisecError` subclasses with a stable `code` (`PS_…`). Retries happen only for network errors, 429 and 5xx, and only on calls that are safe to repeat.
- Log events never contain your API key, request bodies or calldata; `redact()` masks keys in any string.

Palisec is pre-release on Robinhood Chain Testnet (46630). It authorizes; it does not sign or broadcast, and until the on-chain module ships a key that skips Palisec can still transact. Docs: https://palisec.tech/docs/sdk/typescript
