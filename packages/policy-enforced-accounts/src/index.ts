export { canonicalize, policyHash } from "./jcs";
export { REASONS, PALISEC_REASON_MAP, encodeReason, decodeReason, type ReasonCode } from "./reasons";
export { INTERFACE_ID, REGISTRY_ABI } from "./abi";
export {
  DECISIONS,
  INTENT_TYPEHASH,
  RECEIPT_TYPES,
  intentHash,
  receiptDomain,
  recoverReceiptSigner,
  toMessage,
  typedReceipt,
  type DecisionMessage,
  type DecisionName,
  type Intent,
  type ReceiptJson,
} from "./receipt";
export { fetchPolicy, readAccount, supportsStandard, verifyReceipt, type AccountStatus, type Commitment, type ReceiptCheck } from "./read";

/** Reference registry on Robinhood Chain mainnet (4663). Filled in at deployment. */
export const REGISTRY_ADDRESSES: Record<number, `0x${string}`> = {};
