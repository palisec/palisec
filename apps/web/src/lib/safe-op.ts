/**
 * Safe smart accounts with the Safe 4337 module (v0.3.0, EntryPoint v0.7), as deployed on Robinhood Chain
 * Testnet. Pure functions only: shared by the API, the console and the tests.
 *
 * Enforcement model: a Safe whose threshold is 2 and whose owners include PALISEC's co-signer. The agent's
 * key is one owner; PALISEC adds the second signature only for an operation it allowed (or a person
 * approved), for exactly that payload and until its authorization expires. An organization-held recovery
 * owner keeps funds recoverable without PALISEC.
 */
import {
  concat,
  encodeFunctionData,
  encodePacked,
  getAddress,
  hashTypedData,
  keccak256,
  pad,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";

export const SAFE_4337 = {
  chainId: 46630,
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  module: "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226",
  moduleSetup: "0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47",
  singleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
  proxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
} as const satisfies Record<string, string | number>;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const SAFE_ABI = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function isModuleEnabled(address module) view returns (bool)",
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
]);
export const MODULE_SETUP_ABI = parseAbi(["function enableModules(address[] modules)"]);
export const FACTORY_ABI = parseAbi(["function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)"]);
export const MODULE_ABI = parseAbi(["function executeUserOp(address to, uint256 value, bytes data, uint8 operation)"]);
export const ENTRYPOINT_ABI = parseAbi([
  "function getNonce(address sender, uint192 key) view returns (uint256 nonce)",
  "function getUserOpHash((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature) userOp) view returns (bytes32)",
  "function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)",
]);

/** The parameters of a Safe the console creates: owners, a threshold of 2, and the 4337 module enabled at setup. */
export function safeInitializer(owners: Address[], threshold = 2): Hex {
  if (owners.length < 2 || threshold < 2 || threshold > owners.length) throw new Error("A PALISEC smart account needs at least two owners and a threshold of 2 or more.");
  const unique = new Set(owners.map((o) => o.toLowerCase()));
  if (unique.size !== owners.length) throw new Error("Owners must be distinct.");
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: "setup",
    args: [
      owners.map((o) => getAddress(o)),
      BigInt(threshold),
      SAFE_4337.moduleSetup,
      encodeFunctionData({ abi: MODULE_SETUP_ABI, functionName: "enableModules", args: [[SAFE_4337.module]] }),
      SAFE_4337.module,
      ZERO_ADDRESS,
      0n,
      ZERO_ADDRESS,
    ],
  });
}

export function createSafeCalldata(owners: Address[], saltNonce: bigint, threshold = 2): Hex {
  return encodeFunctionData({ abi: FACTORY_ABI, functionName: "createProxyWithNonce", args: [SAFE_4337.singleton, safeInitializer(owners, threshold), saltNonce] });
}

/** The Safe executes exactly one plain call (operation 0). Delegate calls are never produced. */
export function executeCallData(to: Address, valueWei: bigint, data: Hex): Hex {
  return encodeFunctionData({ abi: MODULE_ABI, functionName: "executeUserOp", args: [getAddress(to), valueWei, data, 0] });
}

/** A user operation for EntryPoint v0.7 with no factory and no paymaster. Quantities are hex strings. */
export interface SafeUserOp {
  sender: Address;
  nonce: Hex;
  callData: Hex;
  callGasLimit: Hex;
  verificationGasLimit: Hex;
  preVerificationGas: Hex;
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
  validAfter: number;
  validUntil: number;
}

export const SAFE_OP_TYPES = {
  SafeOp: [
    { name: "safe", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "initCode", type: "bytes" },
    { name: "callData", type: "bytes" },
    { name: "verificationGasLimit", type: "uint128" },
    { name: "callGasLimit", type: "uint128" },
    { name: "preVerificationGas", type: "uint256" },
    { name: "maxPriorityFeePerGas", type: "uint128" },
    { name: "maxFeePerGas", type: "uint128" },
    { name: "paymasterAndData", type: "bytes" },
    { name: "validAfter", type: "uint48" },
    { name: "validUntil", type: "uint48" },
    { name: "entryPoint", type: "address" },
  ],
} as const;

/** The EIP-712 data every owner signs (domain: chain ID and the 4337 module). */
export function safeOpTypedData(op: SafeUserOp, chainId: number = SAFE_4337.chainId) {
  return {
    domain: { chainId, verifyingContract: SAFE_4337.module as Address },
    types: SAFE_OP_TYPES,
    primaryType: "SafeOp" as const,
    message: {
      safe: getAddress(op.sender),
      nonce: BigInt(op.nonce),
      initCode: "0x" as Hex,
      callData: op.callData,
      verificationGasLimit: BigInt(op.verificationGasLimit),
      callGasLimit: BigInt(op.callGasLimit),
      preVerificationGas: BigInt(op.preVerificationGas),
      maxPriorityFeePerGas: BigInt(op.maxPriorityFeePerGas),
      maxFeePerGas: BigInt(op.maxFeePerGas),
      paymasterAndData: "0x" as Hex,
      validAfter: op.validAfter,
      validUntil: op.validUntil,
      entryPoint: SAFE_4337.entryPoint as Address,
    },
  };
}

/** The same typed data with every integer as a decimal string, for JSON and for eth_signTypedData_v4. */
export function safeOpTypedDataJson(op: SafeUserOp, chainId: number = SAFE_4337.chainId) {
  const t = safeOpTypedData(op, chainId);
  return {
    domain: t.domain,
    types: { EIP712Domain: [{ name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], ...SAFE_OP_TYPES },
    primaryType: t.primaryType,
    message: Object.fromEntries(Object.entries(t.message).map(([k, v]) => [k, typeof v === "bigint" || typeof v === "number" ? v.toString() : v])),
  };
}

export const safeOpHash = (op: SafeUserOp, chainId: number = SAFE_4337.chainId): Hex => hashTypedData(safeOpTypedData(op, chainId));

/** Normalizes a 65-byte ECDSA signature to v = 27 or 28, the form Safe treats as a direct signature. */
export function normalizeSignature(sig: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new Error("A signature must be 65 bytes of hex.");
  const v = parseInt(sig.slice(130, 132), 16);
  if (v === 27 || v === 28) return sig.toLowerCase() as Hex;
  if (v === 0 || v === 1) return `${sig.slice(0, 130)}${(v + 27).toString(16)}`.toLowerCase() as Hex;
  throw new Error("Unsupported signature recovery byte.");
}

/** userOp.signature: validAfter (6 bytes), validUntil (6 bytes), then owner signatures sorted by owner address. */
export function packSafeSignature(validAfter: number, validUntil: number, signatures: { signer: Address; signature: Hex }[]): Hex {
  const sorted = [...signatures].sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1));
  return encodePacked(["uint48", "uint48", "bytes"], [validAfter, validUntil, concat(sorted.map((s) => normalizeSignature(s.signature)))]);
}

/** A well-formed but invalid signature of the right length, for gas estimation only. */
export function dummySafeSignature(threshold = 2): Hex {
  const one = concat([keccak256(toHex("palisec.dummy.r")), pad("0x7fff", { size: 32 }), "0x1b"]);
  return encodePacked(["uint48", "uint48", "bytes"], [0, 0, concat(Array.from({ length: threshold }, () => one))]);
}

/** The JSON-RPC form bundlers accept for EntryPoint v0.7 (eth_sendUserOperation, eth_estimateUserOperationGas). */
export function toRpcUserOp(op: SafeUserOp, signature: Hex) {
  return {
    sender: getAddress(op.sender),
    nonce: op.nonce,
    callData: op.callData,
    callGasLimit: op.callGasLimit,
    verificationGasLimit: op.verificationGasLimit,
    preVerificationGas: op.preVerificationGas,
    maxFeePerGas: op.maxFeePerGas,
    maxPriorityFeePerGas: op.maxPriorityFeePerGas,
    signature,
  };
}

/** The packed struct EntryPoint v0.7 takes on chain (handleOps, getUserOpHash). */
export function toPackedUserOp(op: SafeUserOp, signature: Hex) {
  return {
    sender: getAddress(op.sender),
    nonce: BigInt(op.nonce),
    initCode: "0x" as Hex,
    callData: op.callData,
    accountGasLimits: concat([pad(op.verificationGasLimit, { size: 16 }), pad(op.callGasLimit, { size: 16 })]),
    preVerificationGas: BigInt(op.preVerificationGas),
    gasFees: concat([pad(op.maxPriorityFeePerGas, { size: 16 }), pad(op.maxFeePerGas, { size: 16 })]),
    paymasterAndData: "0x" as Hex,
    signature,
  };
}

/** The most this operation can cost the Safe in gas, in wei. */
export const maxCostWei = (op: SafeUserOp) =>
  (BigInt(op.callGasLimit) + BigInt(op.verificationGasLimit) + BigInt(op.preVerificationGas)) * BigInt(op.maxFeePerGas);
