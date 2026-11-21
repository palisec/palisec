# policy-enforced-accounts

Reader and receipt verifier for the draft ERC **Policy-Enforced Agent Accounts**. It answers, from the chain alone:

- Is this account enforced by an external policy signer?
- Which policy is active?
- Is a loosening pending?
- Is this decision receipt genuine?

No API key and no private key are needed.

```sh
npm install policy-enforced-accounts viem
```

```js
import { createPublicClient, http } from "viem";
import { REGISTRY_ADDRESSES, fetchPolicy, readAccount, verifyReceipt } from "policy-enforced-accounts";

const client = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });
const registry = REGISTRY_ADDRESSES[4663];

const status = await readAccount(client, "0x9aEC761B2F0FdA08C683e8388478C9A2F7C9170c", registry);
// { enforced, policySigner, publisher, receiptSigner, policy, pending, mandate, stopped }

const { matches } = await fetchPolicy(status.policy);   // the document hashes to the on-chain commitment
const check = await verifyReceipt(client, receipt, { intent }); // { valid, signer, problems }
```

## What's included

- `readAccount`: ERC-165 discovery (the account first, then the registry), signers, active and pending policy, mandate, and stop state.
- `fetchPolicy`: fetches `policyURI` and checks it against `policyHash`. It is HTTPS only, refuses local and private hosts, and has a time and size limit.
- `verifyReceipt`: checks a receipt against a trusted registry only. It also checks the validity window and the signer: EOA recovery, or ERC-1271 for contract signers. Keys that have been rotated out are rejected unless `allowRotatedSigner` is set for audits.
- `policyHash` / `canonicalize`: RFC 8785 JSON canonicalization, then keccak256.
- `intentHash`, `typedReceipt`, `REASONS`, `encodeReason`, `decodeReason`, `REGISTRY_ABI`, `INTERFACE_ID` (`0xcc16d336`).
- `vectors/vectors.json`: the ERC's test vectors.

## Reference registry

Robinhood Chain mainnet (4663): `0x20D6B38B47F7cb765A2318a1f318ed54a6f87e92`. It was deployed with the deterministic deployer `0x4e59b448…956C`, salt `keccak256("policy-enforced-accounts registry v1")`.

The spec and guide are at https://palisec.tech/docs/standard. License: CC0-1.0.
