import { parseAbi } from "viem";

/** ERC-165 interface id of IPolicyEnforcedAccount (XOR of its six read selectors). */
export const INTERFACE_ID = "0xcc16d336" as const;

export const REGISTRY_ABI = parseAbi([
  "struct Signers { address policySigner; address publisher; address receiptSigner; uint64 since; }",
  "struct PolicyCommitment { bytes32 policyHash; uint64 version; uint64 effectiveAt; string policyURI; string schemaURI; }",
  "function policySigner(address account) view returns (Signers)",
  "function signersAt(address account, uint64 timestamp) view returns (Signers)",
  "function policyOf(address account) view returns (PolicyCommitment)",
  "function pendingPolicyOf(address account) view returns (bool exists, PolicyCommitment)",
  "function mandateOf(address account) view returns (string mandateURI, bytes32 configHash)",
  "function isStopped(address account) view returns (bool)",
  "function supportsInterface(bytes4 interfaceId) view returns (bool)",
  "function declare(address policySigner, address publisher, address receiptSigner)",
  "function activate(address account, bytes32 policyHash, uint64 version, string policyURI, string schemaURI)",
  "function setPending(address account, bytes32 policyHash, uint64 version, uint64 effectiveAt, string policyURI, string schemaURI)",
  "function cancelPending(address account, string reason)",
  "function setStopped(address account, bool stopped, string reason)",
  "function setMandate(address account, string mandateURI, bytes32 configHash)",
  "event SignersDeclared(address indexed account, address policySigner, address publisher, address receiptSigner)",
  "event PolicyActivated(address indexed account, bytes32 indexed policyHash, uint64 version, uint64 effectiveAt, string policyURI, string schemaURI)",
  "event PolicyPending(address indexed account, bytes32 indexed policyHash, uint64 version, uint64 effectiveAt, string policyURI, string schemaURI)",
  "event PolicyCancelled(address indexed account, bytes32 indexed policyHash, uint64 version, string reason)",
  "event EmergencyStop(address indexed account, string reason)",
  "event EmergencyStopLifted(address indexed account)",
  "event MandateSet(address indexed account, string mandateURI, bytes32 configHash)",
]);
