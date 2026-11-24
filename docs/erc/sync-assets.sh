#!/usr/bin/env sh
# Copies the reference implementation into the ERC's assets folder (run from the repository root).
set -e
A=docs/erc/assets/erc-8511
rm -rf "$A" && mkdir -p "$A/client/src" "$A/v1" "$A/v2"
cp contracts/src/peaa/IPolicyEnforcedAccount.sol contracts/src/peaa/PolicyEnforcedRegistry.sol contracts/src/peaa/PolicyDecisionReceipt.sol "$A/"
cp contracts/test/PolicyEnforcedRegistry.t.sol contracts/test/PolicyVectors.t.sol "$A/"
cp contracts/src/peaa/v1/*.sol "$A/v1/"
cp contracts/src/peaa/v2/*.sol "$A/v2/"
cp packages/policy-enforced-accounts/vectors/vectors.json "$A/"
cp packages/policy-enforced-accounts/src/*.ts "$A/client/src/"
cp packages/policy-enforced-accounts/examples/independent-read.mjs "$A/client/"
cp docs/erc/assets-README.md "$A/README.md"
echo "assets synced to $A"
