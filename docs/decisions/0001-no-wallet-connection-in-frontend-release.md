# Decision: no wallet connection in the frontend-only release

**Status:** Accepted for the pre-release frontend · revisit at the API, identity and SDK work

## Short answer

Palisec does need wallets eventually, but only for two jobs, and both are meaningless without the backend. A "Connect wallet" button today would show a connected state that authenticates nothing and authorizes nothing, which the specification explicitly forbids. So the frontend ships without one, and every place a wallet will be needed already says so on screen.

## Who would connect a wallet, according to the spec

| Who | Needs a wallet? | Why |
|---|---|---|
| Website visitors | No | Nothing on the public site touches the chain. Docs, architecture and the policy workbench are read-only or run locally. |
| AI agents | No, by design | Agents call the SDK with an API key. Their signing authority is a constrained smart-account signer inside the protected signing service, never a wallet they hold (§4.4, §2 "A gateway cannot secure a wallet whose key remains outside its control"). |
| Console users signing in | Yes, later | Wallet sign-in is a signed challenge with nonce, domain and expiry (§12), issued and verified by `POST /v1/auth/challenges` and `POST /v1/auth/verify` (§8.1), producing an HttpOnly session. Without that server, a signature proves nothing to anyone. |
| Human approvers | Yes, later | "Approve & Sign" must be an independent wallet signature over the exact UserOperation hash, bound to policy version, reservation and expiry (§6.3, §11.5), and checked by the approval service and the smart account's validation module (§6.2). No real UserOperation exists until the backend and contracts exist. |

## Why not add a connect button anyway

1. **It would claim something untrue.** §1.2 requires the interface to "distinguish live production functionality from simulations and features that are not yet implemented", and §17 says frontend development "must not invent backend behavior to make a screen appear functional". A "connected" wallet badge with no session behind it is exactly that. (§11.3 applies the same rule to pause state: the UI must not claim an account is paused until the system confirms it.)
2. **The spec warns against implied protection.** §8.3: `wrapWallet` "must not be allowed to imply protection if the underlying key can still broadcast unrestricted transactions". A wallet connected to a site with no enforcement path implies protection it does not have.
3. **It is not the product.** §1.3 non-goals include supporting every wallet type, and §6.1 says not to build a wallet "merely for branding". The product is the authorization boundary, not a wallet.
4. **It would add risk for no function.** A wallet connector adds third-party code and asks users to sign messages that nothing verifies.
5. **The release criteria already account for it.** §15.3's end-to-end journey ("approve through an independently authenticated wallet") and the §18 checklist item "Approvals, audit, and emergency controls work end to end" both need the approval service and contracts. A frontend-only release cannot tick them with or without a connect button; adding one would only make the gap look closed.

## Where the absence is visible today

- `/login`: "Sign in with wallet · SIWE" is shown disabled, with "Authentication service not deployed".
- `/console/approvals`: "Approve & Sign" is shown disabled, with the reason that it needs the approval service and an independently authenticated wallet. A clearly labelled unsigned simulation approval exists for exploring the flow.
- `/console/settings`: wallet sign-in, GitHub OAuth, sessions and MFA are each listed as "Not deployed".

## When to add it

- **API, identity, SDK:** wallet sign-in via viem and an EIP-1193 connector, wired to the challenge endpoints and session cookies.
- **Console, audit, approvals:** Approve & Sign through the approver's wallet, bound to the real operation hash and verified by the approval service and validation module.
