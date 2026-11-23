// SPDX-License-Identifier: CC0-1.0
pragma solidity 0.8.28;

/**
 * @title AgentLinks
 * @notice An account states, on chain, which agent ID it has on another service (for example its
 *         Zolva agent). Only the account itself can set or clear its own links: msg.sender is the
 *         account, so a smart account does it with its owners' signatures.
 *
 *  - No owner, no admin, not upgradeable, holds no funds.
 *  - A link is one side of a claim. A reader trusts it only when the other service names this
 *    account back (a two-sided check); this contract does not contact any other service.
 *  - `service` is keccak256 of the service's lowercase name, e.g. keccak256("zolva").
 */
contract AgentLinks {
    error IdTooLong();

    uint256 public constant MAX_ID_BYTES = 128;

    mapping(address account => mapping(bytes32 service => string id)) private _links;

    /// @notice Emitted when an account sets (or clears, with an empty id) its link for a service.
    event LinkSet(address indexed account, bytes32 indexed service, string id);

    /// @notice Set the caller's agent ID on `service`. An empty id clears the link.
    function setLink(bytes32 service, string calldata id) external {
        if (bytes(id).length > MAX_ID_BYTES) revert IdTooLong();
        _links[msg.sender][service] = id;
        emit LinkSet(msg.sender, service, id);
    }

    /// @notice The agent ID `account` declared on `service` ("" when none).
    function linkOf(address account, bytes32 service) external view returns (string memory) {
        return _links[account][service];
    }
}
