# 0004 · Mainnet with a server-held co-signer, behind a switch

Date: 2026-11-18 · Status: accepted

## Context

Smart-account enforcement (decision 0003) runs on testnet with a co-signing key held by the server. The plan
was to wait for the AWS Nitro enclave (Part 11, paid) before mainnet. The owner asked to move to mainnet now.
Robinhood Chain mainnet (4663) is live, and the same Safe and ERC-4337 contracts are deployed there with
identical code.

## Decision

- Support mainnet alongside testnet, as the primary network. It is **on** unless `PALISEC_MAINNET=off`
  (the emergency switch); off means every mainnet request is refused with `PS_CHAIN_001`. Without
  `PALISEC_MAINNET_SIGNER_KEY`, mainnet decisions work but nothing is co-signed. (Amended 2026-11-18: first
  shipped off by default; the owner asked for mainnet to be the default.)
- Mainnet co-signs with **its own key** (`PALISEC_MAINNET_SIGNER_KEY`). The server refuses a mainnet key equal to
  the testnet key. SafeOp signatures name the chain in their EIP-712 domain, so one network's signature cannot be
  replayed on the other.
- Agents are per network. Mainnet agents get `ps_live_` keys; the SDKs take the network from the key and refuse a
  mismatch.
- The server reads each network through Alchemy when a key is set, as Robinhood recommends for production, and
  falls back to the public endpoint if Alchemy fails, so decisions keep working.

## Why this is acceptable before the enclave

- The co-signer holds no funds and cannot move funds alone: every PALISEC account needs 2 of 3 owners (agent,
  PALISEC, recovery). Stealing the co-signer key gives nothing without the agent's key.
- What the enclave adds is protection of the *policy*: with both keys stolen, policy could be bypassed. That risk
  is bounded by keeping balances small until Part 11, and by the recovery owner, who can always move funds.

## Consequences

- Operators must keep the mainnet key only in Vercel (Production, Sensitive). Rotating it means creating new
  accounts (it is a Safe owner), or a Safe owner swap signed by the recovery owner and the agent.
- The Terms of Service were updated for mainnet (real-funds risk, no custody, the PALISEC token) with the owner's
  permission, pending their legal review and the legal entity details.
- Part 11 (enclave) remains the path before holding significant value.
