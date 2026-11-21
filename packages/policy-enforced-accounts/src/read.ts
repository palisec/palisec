import { getAddress, hashTypedData, isAddressEqual, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { INTERFACE_ID, REGISTRY_ABI } from "./abi";
import { policyHash } from "./jcs";
import { intentHash, recoverReceiptSigner, typedReceipt, type Intent, type ReceiptJson } from "./receipt";

export interface Commitment {
  policyHash: Hex;
  version: bigint;
  effectiveAt: bigint;
  policyURI: string;
  schemaURI: string;
}

export interface AccountStatus {
  account: Address;
  /** Where the interface was read: the account itself or the registry. */
  source: Address;
  enforced: boolean;
  policySigner: Address;
  publisher: Address;
  receiptSigner: Address;
  signersSince: bigint;
  policy: Commitment | null;
  pending: Commitment | null;
  mandate: { uri: string; configHash: Hex } | null;
  stopped: boolean;
}

const ZERO = "0x0000000000000000000000000000000000000000";
const ZERO32 = `0x${"0".repeat(64)}`;

/** True if `address` answers ERC-165 for IPolicyEnforcedAccount (a revert or no code counts as no). */
export async function supportsStandard(client: PublicClient, address: Address): Promise<boolean> {
  try {
    return await client.readContract({ address, abi: REGISTRY_ABI, functionName: "supportsInterface", args: [INTERFACE_ID] });
  } catch {
    return false;
  }
}

/**
 * Reads an account's policy status from the chain only. Order: the account itself (if it implements the
 * interface), else the registry. No API, no key.
 */
export async function readAccount(client: PublicClient, account: Address, registry: Address): Promise<AccountStatus> {
  const acct = getAddress(account);
  const source = (await supportsStandard(client, acct)) ? acct : getAddress(registry);
  if (source !== acct && !(await supportsStandard(client, source))) throw new Error(`${source} does not implement IPolicyEnforcedAccount`);
  const r = (functionName: "policySigner" | "policyOf" | "pendingPolicyOf" | "mandateOf" | "isStopped") =>
    client.readContract({ address: source, abi: REGISTRY_ABI, functionName, args: [acct] } as never) as Promise<unknown>;
  const [signers, policy, pending, mandate, stopped] = (await Promise.all([r("policySigner"), r("policyOf"), r("pendingPolicyOf"), r("mandateOf"), r("isStopped")])) as [
    { policySigner: Address; publisher: Address; receiptSigner: Address; since: bigint },
    Commitment,
    [boolean, Commitment],
    [string, Hex],
    boolean,
  ];
  return {
    account: acct,
    source,
    enforced: signers.policySigner !== ZERO,
    policySigner: signers.policySigner,
    publisher: signers.publisher,
    receiptSigner: signers.receiptSigner,
    signersSince: signers.since,
    policy: policy.policyHash === ZERO32 ? null : policy,
    pending: pending[0] ? pending[1] : null,
    mandate: mandate[0] ? { uri: mandate[0], configHash: mandate[1] } : null,
    stopped,
  };
}

/** Fetches a policy document and checks it hashes to the committed policyHash. */
export async function fetchPolicy(c: Commitment, fetcher: typeof fetch = fetch): Promise<{ document: unknown; matches: boolean; hash: Hex }> {
  if (!c.policyURI) throw new Error("This commitment has no policyURI (hash only)");
  const res = await fetcher(c.policyURI, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`policyURI answered HTTP ${res.status}`);
  const document = await res.json();
  const hash = policyHash(document);
  return { document, matches: hash.toLowerCase() === c.policyHash.toLowerCase(), hash };
}

export interface ReceiptCheck {
  valid: boolean;
  signer: Address | null;
  expectedSigner: Address;
  problems: string[];
}

const ERC1271 = parseAbi(["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"]);

/**
 * Verifies a decision receipt against the chain: the signer must be the account's receiptSigner as
 * declared at issuedAt (EOA recovery, or ERC-1271 for a contract signer). If `intent` is given, the
 * receipt must be bound to it.
 */
export async function verifyReceipt(client: PublicClient, receipt: ReceiptJson, opts: { intent?: Intent; now?: bigint } = {}): Promise<ReceiptCheck> {
  const problems: string[] = [];
  const chainId = BigInt(await client.getChainId());
  if (BigInt(receipt.chainId) !== chainId) problems.push(`receipt is for chain ${receipt.chainId}, the client is on ${chainId}`);
  const at = (await client.readContract({
    address: getAddress(receipt.registry),
    abi: REGISTRY_ABI,
    functionName: "signersAt",
    args: [getAddress(receipt.account), BigInt(receipt.issuedAt)],
  })) as { receiptSigner: Address; policySigner: Address };
  const expectedSigner = at.receiptSigner;
  if (expectedSigner === ZERO) problems.push("the account had no declared receipt signer at issuedAt");
  let signer: Address | null = null;
  try {
    signer = await recoverReceiptSigner(receipt);
  } catch {
    /* not an EOA signature */
  }
  let sigOk = signer !== null && expectedSigner !== ZERO && isAddressEqual(signer, expectedSigner);
  if (!sigOk && expectedSigner !== ZERO && (await client.getCode({ address: expectedSigner }))?.length) {
    try {
      const magic = await client.readContract({ address: expectedSigner, abi: ERC1271, functionName: "isValidSignature", args: [hashTypedData(typedReceipt(receipt)), receipt.signature] });
      sigOk = magic === "0x1626ba7e";
      if (sigOk) signer = expectedSigner;
    } catch {
      /* invalid */
    }
  }
  if (!sigOk) problems.push(`signature is not from the declared receipt signer ${expectedSigner}`);
  if (opts.intent && intentHash(opts.intent).toLowerCase() !== receipt.intentHash.toLowerCase()) problems.push("receipt is not bound to this intent");
  if (opts.now !== undefined && BigInt(receipt.expiresAt) < opts.now) problems.push("receipt has expired");
  return { valid: problems.length === 0, signer, expectedSigner, problems };
}
