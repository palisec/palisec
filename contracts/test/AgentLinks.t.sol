// SPDX-License-Identifier: CC0-1.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentLinks} from "../src/links/AgentLinks.sol";

contract AgentLinksTest is Test {
    AgentLinks links;
    bytes32 constant ZOLVA = keccak256("zolva");
    address account = address(0xA11CE);
    address other = address(0xB0B);

    event LinkSet(address indexed account, bytes32 indexed service, string id);

    function setUp() public {
        links = new AgentLinks();
    }

    function test_accountSetsItsOwnLink() public {
        vm.expectEmit(true, true, false, true);
        emit LinkSet(account, ZOLVA, "8a0ab89f-8224-4500-a346-eeda707dbea9");
        vm.prank(account);
        links.setLink(ZOLVA, "8a0ab89f-8224-4500-a346-eeda707dbea9");
        assertEq(links.linkOf(account, ZOLVA), "8a0ab89f-8224-4500-a346-eeda707dbea9");
    }

    function test_nobodyCanWriteAnotherAccountsLink() public {
        vm.prank(account);
        links.setLink(ZOLVA, "a");
        vm.prank(other);
        links.setLink(ZOLVA, "b");
        assertEq(links.linkOf(account, ZOLVA), "a");
        assertEq(links.linkOf(other, ZOLVA), "b");
    }

    function test_servicesAreSeparate() public {
        vm.startPrank(account);
        links.setLink(ZOLVA, "a");
        links.setLink(keccak256("other"), "b");
        vm.stopPrank();
        assertEq(links.linkOf(account, ZOLVA), "a");
        assertEq(links.linkOf(account, keccak256("other")), "b");
    }

    function test_emptyIdClears() public {
        vm.startPrank(account);
        links.setLink(ZOLVA, "a");
        links.setLink(ZOLVA, "");
        vm.stopPrank();
        assertEq(links.linkOf(account, ZOLVA), "");
    }

    function test_idLengthIsBounded() public {
        bytes memory longId = new bytes(129);
        vm.prank(account);
        vm.expectRevert(AgentLinks.IdTooLong.selector);
        links.setLink(ZOLVA, string(longId));
        vm.prank(account);
        links.setLink(ZOLVA, string(new bytes(128)));
    }

    function testFuzz_onlyCallerIsWritten(address a, address b, string calldata id) public {
        vm.assume(a != b && bytes(id).length <= 128);
        vm.prank(a);
        links.setLink(ZOLVA, id);
        assertEq(links.linkOf(b, ZOLVA), "");
        assertEq(links.linkOf(a, ZOLVA), id);
    }

    function test_noValueAccepted() public {
        vm.deal(account, 1 ether);
        vm.prank(account);
        (bool ok,) = address(links).call{value: 1}(abi.encodeCall(AgentLinks.setLink, (ZOLVA, "a")));
        assertFalse(ok);
    }
}
