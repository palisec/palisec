# Security policy

Palisec is pre-release. No production service, enclave or smart-account module is deployed, and nothing in this repository should protect real funds yet.

## Reporting a vulnerability

The repository is private during pre-release. Report suspected vulnerabilities directly to the maintainers through the channel you were given access by; do not open a public issue. A public private-disclosure channel is a release gate (see the security model) and will be published here before the first public release.

Include the affected component (policy schema, reference evaluator, web app), steps to reproduce, and the impact you observed. Do not test against systems you do not own, and do not use real funds or production keys.

## Scope

In scope today:

- `packages/policy-schema`: the canonical schema, validator and deterministic reference evaluator.
- `apps/web`: the public site, documentation, policy workbench and console simulation workspace.

The protected signing service, API, chain workers and contracts described in the specification are not built yet. Findings about their design are welcome as design feedback.

## Handling

Reports are acknowledged, reproduced, and fixed with a regression test. The fix and its scope are noted in the changelog once released.
