# Security policy

Palisec is a pre-release service on Robinhood Chain Testnet at https://palisec.tech. The authorization API and console are live; protected signing, the enclave and the on-chain smart-account module are not deployed, so nothing here should protect real funds yet.

## Reporting a vulnerability

Email **security@palisec.tech** (also published at https://palisec.tech/.well-known/security.txt). Do not open a public issue. Reports are acknowledged within three working days.

Include the affected component (policy schema, reference evaluator, web app), steps to reproduce, and the impact you observed. Test only against your own organization on testnet. Do not access other organizations' data, degrade the service, or use real funds or production keys. Good-faith research within these rules will not be pursued.

## Scope

In scope today:

- `packages/policy-schema`: the canonical schema, validator and deterministic reference evaluator.
- `apps/web`: the public site, documentation, policy workbench and the wallet-authenticated console.
- `apps/web/src/server` and `apps/web/src/app/api/v1`: the authorization and control-plane API (sign-in, sessions, organizations, agents, API keys, policies, operations, approvals, audit) and `apps/web/db/migrations`.
- `.github/workflows`: CI, security scans and backups.

The protected signing service, chain workers and contracts described in the specification are not built yet. Findings about their design are welcome as design feedback.

## Handling

Reports are acknowledged, reproduced, and fixed with a regression test. The fix and its scope are noted in the changelog once released.
