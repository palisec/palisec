// SPDX-License-Identifier: CC0-1.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PolicyEnforcedRegistry} from "../src/peaa/PolicyEnforcedRegistry.sol";
import {IPolicyEnforcedAccount} from "../src/peaa/IPolicyEnforcedAccount.sol";
import {IPolicyEnforcedAccount as IV1} from "../src/peaa/v1/IPolicyEnforcedAccount.sol";

/// Registry v2 against Robinhood Chain mainnet state: deployed through the deterministic deployer with its
/// published salt, next to the live v1 registry, with the real demo Safe moving to it.
/// FORK=1 forge test --match-contract RegistryFork
contract RegistryForkTest is Test {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant V1 = 0x20D6B38B47F7cb765A2318a1f318ed54a6f87e92;
    address constant SAFE = 0x9aEC761B2F0FdA08C683e8388478C9A2F7C9170c;
    bytes32 constant SALT = keccak256("policy-enforced-accounts registry v2");
    bool skipFork;
    PolicyEnforcedRegistry reg;

    function setUp() public {
        if (vm.envOr("FORK", uint256(0)) != 1) {
            skipFork = true;
            return;
        }
        vm.createSelectFork("mainnet");
        bytes memory init = type(PolicyEnforcedRegistry).creationCode;
        (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(SALT, init));
        require(ok, "deploy");
        reg = PolicyEnforcedRegistry(vm.computeCreate2Address(SALT, keccak256(init), CREATE2_DEPLOYER));
    }

    function test_fork_safeMovesToV2() public {
        if (skipFork) return;
        assertGt(address(reg).code.length, 0);
        IV1.Signers memory old = IV1(V1).policySigner(SAFE);
        assertTrue(old.policySigner != address(0), "the Safe declared on v1");
        IV1.PolicyCommitment memory oldPolicy = IV1(V1).policyOf(SAFE);

        vm.prank(SAFE);
        reg.declare(old.policySigner, old.publisher, old.receiptSigner, 900, 1);
        IPolicyEnforcedAccount.Signers memory s = reg.policySigner(SAFE);
        assertEq(s.publisher, old.publisher);
        assertEq(s.minDelay, 900);

        uint64 at = uint64(block.timestamp) + 900;
        vm.prank(old.publisher);
        reg.setPending(SAFE, oldPolicy.policyHash, oldPolicy.version, at, oldPolicy.policyURI, oldPolicy.schemaURI);
        vm.warp(at);
        vm.prank(old.publisher);
        reg.activate(SAFE, oldPolicy.policyHash, oldPolicy.version, oldPolicy.policyURI, oldPolicy.schemaURI);
        assertEq(reg.policyOf(SAFE).policyHash, oldPolicy.policyHash);
        // v1 is untouched and still readable.
        assertEq(IV1(V1).policyOf(SAFE).policyHash, oldPolicy.policyHash);
        assertTrue(PolicyEnforcedRegistry(V1).supportsInterface(type(IV1).interfaceId));
        assertTrue(reg.supportsInterface(type(IPolicyEnforcedAccount).interfaceId));
    }
}
