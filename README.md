# Palisec

The authorization boundary for autonomous on-chain agents on Robinhood Chain. Every action an agent wants to take is checked against a signed policy before anything is signed or sent, and refusals come back with a reason code. Live at https://palisec.tech.

## Layout

| Path | What |
|---|---|
| `apps/web` | palisec.tech: public site, docs, console and the `/api/v1` authorization API (Next.js) |
| `packages/policy-schema` | Policy schema, reason codes and the reference evaluator |
| `services/policy-engine` | Rust policy engine (WebAssembly), dual-evaluated with the reference |
| `packages/policy-engine` | The engine's WebAssembly build, embedded in the app |
| `packages/sdk`, `packages/sdk-python` | TypeScript (`@palisec/sdk`) and Python (`palisec`) SDKs |
| `packages/policy-enforced-accounts` | Client library for ERC-8511 "Policy-Enforced Agent Accounts" (draft) |
| `contracts` | Solidity: the policy-enforced accounts registry, PalisecCredits and tests (Foundry) |
| `docs/erc` | The ERC-8511 text (draft) and its reference implementation |
| `docs/decisions` | Architecture decision records |

## Development

Requires Node 22 and pnpm.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm dev:web
```

Contracts: `cd contracts && forge test`.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.
