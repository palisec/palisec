# 0003 · On-chain enforcement through a Safe with PALISEC as a co-signer

Date: 2026-11-17 · Status: accepted (testnet)

## Context

Part 8 needs an account that refuses to execute anything PALISEC did not authorize, so that a stolen agent key cannot
bypass the policy engine. The specification sketched a custom ERC-7579 validator module. Robinhood Chain Testnet already
has the canonical, audited Safe 1.4.1 contracts, the Safe 4337 module v0.3.0 and EntryPoint v0.7 deployed (verified on
chain), and Alchemy runs a free ERC-4337 bundler for the network.

## Decision

A PALISEC smart account is a standard Safe with the Safe 4337 module enabled, a threshold of **2**, and three owners:
the agent's key, PALISEC's co-signer, and an organization-held recovery owner.

- PALISEC builds the user operation itself from the evaluated intent (`executeUserOp(to, value, data, 0)`, never a
  delegate call), with `validUntil` equal to the authorization's expiry, and stores it.
- The agent signs the EIP-712 SafeOp. PALISEC checks the signature recovers to an owner other than itself, re-reads the
  account on chain (threshold 2, module enabled, PALISEC an owner), claims the operation once together with its audit
  event in one SQL statement, co-signs, and submits through the bundler.
- The recovery owner plus either other key can move funds, so nothing is stranded if PALISEC is unavailable.

No new contract is written or deployed.

## Consequences

- Enforcement rests on audited, widely deployed contracts; there is no PALISEC Solidity to audit for this release.
- On testnet the co-signer is a server-held key (`PALISEC_SIGNER_KEY`). A compromised server could co-sign; mainnet
  requires the co-signer to live in the attested enclave (Part 11) before any real funds.
- The recovery owner is a deliberate human bypass. It is documented, and it cannot be exercised by the agent alone.
- Gas is paid by the Safe (no paymaster). PALISEC bounds the call gas by the authorized `gas_limit` and reports
  `max_cost_wei` before the agent signs.
- Agents that keep sending from a plain key are still enforced only in their own process; the docs and the console say
  which agents are enforced on chain.
