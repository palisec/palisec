# Security policy

Palisec runs at https://palisec.tech on Robinhood Chain mainnet (4663, real funds) and testnet (46630). The authorization API, console and smart-account execution are live: a Safe with threshold 2 and PALISEC's co-signer as an owner executes only what PALISEC allowed or a person approved (first mainnet executions verified 2026-11-18). Co-signer keys are held by the PALISEC server, one per network; moving them into an attested enclave and an independent audit are on the roadmap, so start mainnet use with small balances.

## Reporting a vulnerability

Send a direct message to **@palisecagents on X** (https://x.com/palisecagents), as published at https://palisec.tech/.well-known/security.txt. Do not open a public issue. Reports are acknowledged within three working days.

Include the affected component (policy schema, reference evaluator, web app, API, smart-account execution), steps to reproduce, and the impact you observed. Test only against your own organization, on testnet. Do not access other organizations' data, degrade the service, or use other people's funds or keys. Good-faith research within these rules will not be pursued.

## Scope

In scope today:

- `packages/policy-schema` and `services/policy-engine`: the canonical schema, validator, reference evaluator and the Rust engine that must agree with it.
- `apps/web`: the public site, documentation, policy workbench (including its Live API mode) and the wallet-authenticated console.
- `apps/web/src/server` and `apps/web/src/app/api`: the authorization and control-plane API (sign-in, sessions, organizations, agents, scoped API keys, policies, operations, approvals, audit, webhooks, MCP), smart-account preparation, co-signing and bundler submission, and `apps/web/db/migrations`.
- `packages/sdk` and `packages/sdk-python`: the published SDKs.
- `.github/workflows`: CI, security scans and releases.

The enclave signer described in the specification is not built yet. Findings about its design are welcome as design feedback.

## Handling

Reports are acknowledged, reproduced, and fixed with a regression test. The fix and its scope are noted in the changelog once released.
