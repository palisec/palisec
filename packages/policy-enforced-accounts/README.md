# policy-enforced-accounts

Reader and receipt verifier for **ERC-8511: Policy-Enforced Agent Accounts** (draft). It answers, from the chain alone:

- Is this account enforced by an external policy signer, and how long must changes wait?
- Which policy is active?
- Is a change pending, of the policy or of the signers?
- Is this decision receipt genuine, and may I act on it now?

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
// { standard, enforced, policySigner, publisher, receiptSigner, minDelay, signerType, pendingSigners, policy, pending, mandate, stopped, stopHeldByAccount }

const { matches } = await fetchPolicy(status.policy);   // the document hashes to the on-chain commitment

// An audit: is this receipt genuine?
const check = await verifyReceipt(client, receipt, { intent }); // { valid, signer, problems }

// Acting on an ALLOW (a gate): also the current policy, no emergency stop, and a decisionId used only once.
const gate = await verifyReceipt(client, receipt, { intent, use: true, seen: usedIdsStore });
```

## What's included

- `readAccount`: ERC-165 discovery (the account first, then the registry), signers with `minDelay` and `signerType`, a pending signer change, active and pending policy, mandate, and stop state, including whether the account itself holds the stop (`stopHeldByAccount`: only the account can lift it). It reads v3, v2 and first-draft (v1) sources.
- `fetchPolicy`: fetches `policyURI` and checks it against `policyHash`. It is HTTPS only, refuses local and private hosts, and has a time and size limit.
- `verifyReceipt`: checks a receipt against a trusted registry only. It also checks the validity window and the signer: EOA recovery, or ERC-1271 for contract signers. Keys that have been rotated out are rejected unless `allowRotatedSigner` is set for audits. With `use: true` it adds the use-time rules: an ALLOW bound to the intent, the registry's current policy hash and version, no emergency stop, and a `decisionId` not used before. `seen` is your store, with one atomic `claim(id)` that returns true only the first time (for example `INSERT ... ON CONFLICT DO NOTHING`, or Redis `SET NX`); the default is in memory, per process.
- `policyHash` / `canonicalize`: RFC 8785 JSON canonicalization, then keccak256.
- `intentHash` (v2: includes `operation`, 0 call or 1 delegatecall), `intentHashV1`, `typedReceipt`, `REASONS`, `encodeReason`, `decodeReason`, `REGISTRY_ABI` (v3), `REGISTRY_V2_ABI`, `REGISTRY_V1_ABI`, `INTERFACE_ID` (`0xf594edcd`), `INTERFACE_ID_V2` (`0x7e0f19f9`), `INTERFACE_ID_V1` (`0xcc16d336`), `SIGNER_TYPES`, `PALISEC_REASON_MAP`.
- `vectors/vectors.json`: the ERC's test vectors (v3; receipts as in v2), and `vectors/vectors-v1.json` for the first draft.

## Reference registry

Robinhood Chain mainnet (4663), v3: `0x4d37D0aD95593b2C65A0c2A98D5676D51DF3FDAB`. It was deployed with the deterministic deployer `0x4e59b448…956C`, salt `keccak256("policy-enforced-accounts registry v3")`. v3 adds the stop hold: a stop the account engaged can only be lifted by the account.

Registry v2, `0xCa3bAE26d29a3A2cED7B87Fa996ca4C44367448d`, stays as it is and readable; its receipts verify like v3's (domain version "2"). The first draft's registry, `0x20D6B38B47F7cb765A2318a1f318ed54a6f87e92`, stays as it is. Receipts issued under it verify with EIP-712 domain version "1".

## Upgrading from 0.2

- `REGISTRY_ADDRESSES` points to v3. Pass `REGISTRY_V2_ADDRESSES[4663]` as `registry` to read or audit v2.
- `standardOf` and `readAccount` return `"v3"` for the new registry; `readAccount` adds `stopHeldByAccount`.
- `PALISEC_REASON_MAP` maps `PS_PRICE_001` (no reliable price for a spent token) to `DEPENDENCY_UNAVAILABLE` and `PS_SIM_002` (outflows unknown) to `SIMULATION_UNAVAILABLE`. The treasury guard codes map as `PS_TREASURY_001` (destination) and `PS_TREASURY_004` (liquidity) to `DENY_RULE`, `PS_TREASURY_002` (daily sell cap) to `OVER_BUDGET`, `PS_TREASURY_003` (approval) to `APPROVAL_RISK`, and `PS_TREASURY_005` (locked guard, a rejected policy change) to `DENY_RULE`; the detail code carries `palisec:PS_TREASURY_00x`.

## Upgrading from 0.1

- The intent type has an `operation` field, so `intentHash` differs from 0.1 for the same transaction; `intentHashV1` keeps the old one.
- `REGISTRY_ADDRESSES` points to v2. Pass `REGISTRY_V1_ADDRESSES[4663]` as `registry` to read or audit the first draft.
- `readAccount` returns `standard`, `minDelay`, `signerType` and `pendingSigners`.

The spec and guide are at https://palisec.tech/docs/standard.

License: MIT (see LICENSE). The Solidity contracts in contracts/ and the specification in erc/ are dedicated to the public domain under CC0-1.0, as marked in each file.
