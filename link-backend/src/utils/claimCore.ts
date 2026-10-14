import { createHmac, randomBytes } from "node:crypto";
import {
  AbiCoder,
  TypedDataDomain,
  TypedDataEncoder,
  TypedDataField,
  concat,
  hexlify,
  keccak256,
  toUtf8Bytes,
  verifyTypedData,
} from "ethers";
import { env } from "../config/env";
import { ValidationError } from "./errors";

/**
 * Everything both sides of the Nomine Claim Core boundary have to agree on.
 *
 * The contract is the source of truth (`link-contracts/contracts/NomineClaimCore.sol`) and
 * the integration contract is fixed (`docs/nomine-claim-core-integration.md` §2, §3, §4).
 * The type strings, the field order, the leaf/pair rules and the digest derivation here
 * are reproduced byte for byte; a divergence does not degrade gracefully, it shows up as
 * `EntitlementNotListed`, `ApprovalMismatch` or `InvalidClaimantConsent` on-chain.
 */

// ---------------------------------------------------------------------------
// EIP-712 domain and types
// ---------------------------------------------------------------------------

/** `EIP712("NomineClaimCore", "1")` in the contract constructor. */
export const CLAIM_CORE_DOMAIN_NAME = "NomineClaimCore";
export const CLAIM_CORE_DOMAIN_VERSION = "1";

/**
 * Primary type strings, exactly as the contract hashes them
 * (`CLAIM_REQUEST_TYPEHASH` / `APPROVAL_TYPEHASH`). Never reorder, never rename.
 */
export const CLAIM_REQUEST_TYPE_STRING =
  "ClaimRequest(uint256 campaignId,bytes32 entitlementId,address wallet,uint256 amount,uint64 deadline)";

export const APPROVAL_TYPE_STRING =
  "Approval(uint256 campaignId,bytes32 entitlementId,address wallet,uint256 amount,uint64 deadline,bytes32 consentDigest)";

const abiCoder = AbiCoder.defaultAbiCoder();

export const CLAIM_REQUEST_TYPEHASH = keccak256(
  toUtf8Bytes(CLAIM_REQUEST_TYPE_STRING)
);

export const APPROVAL_TYPEHASH = keccak256(toUtf8Bytes(APPROVAL_TYPE_STRING));

/** The exact fields the claimant signs. `wallet` is the payout address. */
export const CLAIM_REQUEST_TYPES: Record<string, TypedDataField[]> = {
  ClaimRequest: [
    { name: "campaignId", type: "uint256" },
    { name: "entitlementId", type: "bytes32" },
    { name: "wallet", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
};

/** Both authorities attest the same payload, bound to the consent digest. */
export const APPROVAL_TYPES: Record<string, TypedDataField[]> = {
  Approval: [
    { name: "campaignId", type: "uint256" },
    { name: "entitlementId", type: "bytes32" },
    { name: "wallet", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "consentDigest", type: "bytes32" },
  ],
};

export interface ClaimRequestPayload {
  campaignId: bigint | number;
  entitlementId: string;
  wallet: string;
  amount: bigint | number;
  deadline: bigint | number;
}

export interface ApprovalPayload extends ClaimRequestPayload {
  consentDigest: string;
}

/**
 * The EIP-712 domain for the configured Claim Core deployment.
 *
 * Both parameters are the configured values rather than literals so a signature produced
 * for one chain or one deployment can never be replayed against another.
 */
export function claimCoreDomain(
  chainId: number = env.CHAIN_ID,
  verifyingContract: string = env.CLAIM_CORE_CONTRACT_ADDRESS
): TypedDataDomain {
  return {
    name: CLAIM_CORE_DOMAIN_NAME,
    version: CLAIM_CORE_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
}

/**
 * The EIP-712 struct hash of the claimant's request.
 *
 * Mirrors `_hashClaimRequest`: `keccak256(abi.encode(CLAIM_REQUEST_TYPEHASH, ...))`.
 */
export function hashClaimRequestStruct(request: ClaimRequestPayload): string {
  return keccak256(
    abiCoder.encode(
      ["bytes32", "uint256", "bytes32", "address", "uint256", "uint64"],
      [
        CLAIM_REQUEST_TYPEHASH,
        request.campaignId,
        request.entitlementId,
        request.wallet,
        request.amount,
        request.deadline,
      ]
    )
  );
}

/** Mirrors `_hashApproval`: `keccak256(abi.encode(APPROVAL_TYPEHASH, ...))`. */
export function hashApprovalStruct(approval: ApprovalPayload): string {
  return keccak256(
    abiCoder.encode(
      ["bytes32", "uint256", "bytes32", "address", "uint256", "uint64", "bytes32"],
      [
        APPROVAL_TYPEHASH,
        approval.campaignId,
        approval.entitlementId,
        approval.wallet,
        approval.amount,
        approval.deadline,
        approval.consentDigest,
      ]
    )
  );
}

/**
 * The digest the claimant signs, and the value both authorities must echo as
 * `consentDigest`.
 *
 * `digest = _hashTypedDataV4(hashStruct(ClaimRequest))`, i.e.
 * `TypedDataEncoder.hash(domain, CLAIM_REQUEST_TYPES, request)`.
 */
export function consentDigest(
  request: ClaimRequestPayload,
  chainId: number = env.CHAIN_ID,
  verifyingContract: string = env.CLAIM_CORE_CONTRACT_ADDRESS
): string {
  return TypedDataEncoder.hash(
    claimCoreDomain(chainId, verifyingContract),
    CLAIM_REQUEST_TYPES,
    request
  );
}

/** The digest the issuer approver and the Resolver sign. */
export function approvalDigest(
  approval: ApprovalPayload,
  chainId: number = env.CHAIN_ID,
  verifyingContract: string = env.CLAIM_CORE_CONTRACT_ADDRESS
): string {
  return TypedDataEncoder.hash(
    claimCoreDomain(chainId, verifyingContract),
    APPROVAL_TYPES,
    approval
  );
}

/**
 * Recovers the address that signed an EIP-712 payload, or null when the signature is not
 * a recoverable ECDSA signature.
 *
 * Returns null rather than throwing so callers can answer with their own controlled
 * message: a library's recovery error can quote the signature it was given.
 */
export function recoverClaimRequestSigner(
  request: ClaimRequestPayload,
  signature: string
): string | null {
  return recoverTypedDataSigner(CLAIM_REQUEST_TYPES, request, signature);
}

export function recoverApprovalSigner(
  approval: ApprovalPayload,
  signature: string
): string | null {
  return recoverTypedDataSigner(APPROVAL_TYPES, approval, signature);
}

function recoverTypedDataSigner(
  types: Record<string, TypedDataField[]>,
  payload: ClaimRequestPayload | ApprovalPayload,
  signature: string
): string | null {
  try {
    const recovered = verifyTypedData(
      claimCoreDomain(),
      types,
      payload as unknown as Record<string, unknown>,
      signature
    );
    return typeof recovered === "string" ? recovered.toLowerCase() : null;
  } catch {
    // A malformed signature, a wrong length or a non-recoverable `v` all land here. The
    // caller answers with its own controlled message.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Entitlement identifiers and the membership commitment
// ---------------------------------------------------------------------------

const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export function isEntitlementId(value: unknown): value is string {
  return typeof value === "string" && BYTES32_PATTERN.test(value);
}

export function assertEntitlementId(value: string): string {
  if (!isEntitlementId(value)) {
    throw new ValidationError("Invalid entitlement identifier");
  }
  if (BigInt(value) === 0n) {
    throw new ValidationError("Invalid entitlement identifier");
  }
  return value;
}

/**
 * One high-entropy, campaign-specific identifier.
 *
 * 32 random bytes, generated at assignment time and persisted. It is never derived from
 * an email and never a public hash of one (§4), so the identifier carries no identity
 * information and cannot be recomputed by anyone holding the email.
 */
export function generateEntitlementId(): string {
  for (;;) {
    const candidate = hexlify(randomBytes(32));
    // Zero is the only value the contract forbids; rejecting it here keeps the helper's
    // contract ("any output of this function is a usable identifier") true.
    if (BigInt(candidate) !== 0n) {
      return candidate;
    }
  }
}

/** byte-order comparison of two identifiers, as the contract's `<=` does on `bytes32`. */
export function compareEntitlementIds(a: string, b: string): number {
  const left = BigInt(a);
  const right = BigInt(b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * The exact set in the order `createCampaign` requires: strictly ascending.
 *
 * That single constraint is what makes the set non-empty, non-zero and unique on-chain,
 * and it fixes the funded count (§4).
 */
export function sortEntitlementIds(ids: readonly string[]): string[] {
  const sorted = ids.map((id) => assertEntitlementId(id));
  sorted.sort(compareEntitlementIds);

  for (let i = 1; i < sorted.length; i += 1) {
    if (compareEntitlementIds(sorted[i - 1], sorted[i]) >= 0) {
      throw new ValidationError(
        "Entitlement identifiers must be unique; the committed set is strictly ascending"
      );
    }
  }

  return sorted;
}

/** `_leaf(id) = keccak256(abi.encodePacked(id))`, i.e. keccak over the raw 32 bytes. */
export function entitlementLeaf(entitlementId: string): string {
  return keccak256(assertEntitlementId(entitlementId));
}

/** Order-independent pair hash, matching `_hashPair` and OZ `MerkleProof`. */
export function hashEntitlementPair(a: string, b: string): string {
  const [left, right] =
    BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return keccak256(concat([left, right]));
}

export interface EntitlementTree {
  /** Sorted identifiers, in the order the leaves were built. */
  ids: string[];
  /** layers[0] is the leaf level; the last layer holds the root. */
  layers: string[][];
  root: string;
}

/**
 * The commitment tree over the listed identifiers.
 *
 * Reproduces `_commitmentFrom` exactly: leaves are hashed identifiers, pairs are hashed in
 * sorted order, and the last node of an odd level is promoted unchanged. Any divergence
 * from these rules shows up on-chain as `EntitlementNotListed`.
 */
export function buildEntitlementTree(ids: readonly string[]): EntitlementTree {
  const sorted = sortEntitlementIds(ids);
  if (sorted.length === 0) {
    throw new ValidationError("A campaign must list at least one entitlement");
  }

  const layers: string[][] = [sorted.map(entitlementLeaf)];

  while (layers[layers.length - 1].length > 1) {
    const level = layers[layers.length - 1];
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(
        i + 1 < level.length ? hashEntitlementPair(level[i], level[i + 1]) : level[i]
      );
    }
    layers.push(next);
  }

  return { ids: sorted, layers, root: layers[layers.length - 1][0] };
}

/** The Merkle root committed at funding. */
export function entitlementRoot(ids: readonly string[]): string {
  return buildEntitlementTree(ids).root;
}

/**
 * The proof for one listed identifier, or an empty array for a single-entitlement
 * campaign (the root is its own leaf).
 *
 * Throws when the identifier is not part of the committed set, so a caller cannot build a
 * proof for something the campaign never listed.
 */
export function buildEntitlementProof(
  ids: readonly string[],
  entitlementId: string
): string[] {
  const tree = buildEntitlementTree(ids);
  const wanted = BigInt(assertEntitlementId(entitlementId));
  const index = tree.ids.findIndex((id) => BigInt(id) === wanted);

  if (index < 0) {
    throw new ValidationError("Entitlement is not listed in this campaign");
  }

  const proof: string[] = [];
  let cursor = index;

  for (let level = 0; level < tree.layers.length - 1; level += 1) {
    const nodes = tree.layers[level];
    const sibling = cursor % 2 === 0 ? cursor + 1 : cursor - 1;
    if (sibling < nodes.length) {
      proof.push(nodes[sibling]);
    }
    cursor = Math.floor(cursor / 2);
  }

  return proof;
}

/** OZ `MerkleProof.verify` over the leaf of the identifier. */
export function verifyEntitlementProof(
  proof: readonly string[],
  root: string,
  entitlementId: string
): boolean {
  let computed = entitlementLeaf(entitlementId);
  for (const node of proof) {
    computed = hashEntitlementPair(computed, node);
  }
  return BigInt(computed) === BigInt(root);
}

// ---------------------------------------------------------------------------
// Verified-email eligibility and the eligibility index
// ---------------------------------------------------------------------------

/**
 * Conservative, provider-compatible normalization: trim, Unicode NFC, lower-case the
 * whole address.
 *
 * Deliberately **no** Gmail-style dot or plus-alias merging (§5): `a.b@x` and `ab@x` are
 * different mailboxes as far as the identity provider is concerned, and merging them would
 * make one person eligible for another person's entitlement.
 */
export function normalizeVerifiedEmail(email: string): string {
  return email.trim().normalize("NFC").toLowerCase();
}

/**
 * `SERVER_PEPPER` is consumed as its hex-decoded bytes, exactly as
 * `computeRecipientCommit` already treats the same variable. Decoding is what gives the
 * HMAC key full entropy instead of the ASCII of its hex form.
 */
function pepperKeyMaterial(pepper: string): Buffer {
  if (/^0x(?:[0-9a-fA-F]{2})+$/.test(pepper)) {
    return Buffer.from(pepper.slice(2), "hex");
  }
  return Buffer.from(pepper, "utf8");
}

/**
 * `HMAC-SHA256(SERVER_PEPPER, normalizedEmail)`, as lower-case hex.
 *
 * The keyed hash is what makes the stored value an eligibility index rather than a
 * dictionary lookup: without the pepper, a candidate email cannot be tested against it.
 */
export function emailHashFromNormalized(
  normalizedEmail: string,
  pepper: string = env.SERVER_PEPPER
): string {
  return createHmac("sha256", pepperKeyMaterial(pepper))
    .update(normalizedEmail, "utf8")
    .digest("hex");
}

/** Normalizes and hashes. Used only for the *verified* provider address (§5). */
export function emailHashFor(email: string): string {
  return emailHashFromNormalized(normalizeVerifiedEmail(email));
}

/**
 * The eligibility index for an authenticated account.
 *
 * The email comes server-side from the identity provider's linked account and nowhere
 * else: caller-supplied email, query parameters and UI flags are never proof (§5).
 */
export function eligibilityEmailHash(email: string | null | undefined): string | null {
  if (typeof email !== "string") {
    return null;
  }
  const normalized = normalizeVerifiedEmail(email);
  if (!normalized) {
    return null;
  }
  return emailHashFromNormalized(normalized);
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export interface CampaignConfigPayload {
  issuerApprover: string;
  resolver: string;
  /** USDC base units, as a decimal string (`,uint128 allocation`). */
  allocation: string;
  openingTime: number;
  expiryTime: number;
  entitlementIds: string[];
}

/**
 * A commitment to the prepared configuration, so `confirm` can prove the funded campaign
 * is the one that was prepared rather than merely one that looks similar.
 */
export function campaignParamsHash(config: {
  issuerApprover: string;
  resolver: string;
  allocation: string;
  openingTime: number;
  expiryTime: number;
  entitlementCount: number;
  entitlementRoot: string;
}): string {
  return keccak256(
    abiCoder.encode(
      ["address", "address", "uint128", "uint64", "uint64", "uint32", "bytes32"],
      [
        config.issuerApprover,
        config.resolver,
        BigInt(config.allocation),
        config.openingTime,
        config.expiryTime,
        config.entitlementCount,
        config.entitlementRoot,
      ]
    )
  );
}

/** The funded budget implied by the fixed allocation and count (`allocation × count`). */
export function campaignBudget(allocation: string, count: number): string {
  return (BigInt(allocation) * BigInt(count)).toString();
}

export function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function fromUnixSeconds(seconds: bigint | number): Date {
  return new Date(Number(seconds) * 1000);
}

/** The canonical `ClaimRequest` struct for a stored request. */
export function claimRequestPayload(input: {
  onchainCampaignId: bigint | number;
  entitlementId: string;
  walletAddress: string;
  amount: string;
  deadline: Date;
}): ClaimRequestPayload {
  return {
    campaignId: input.onchainCampaignId,
    entitlementId: input.entitlementId,
    wallet: input.walletAddress,
    amount: BigInt(input.amount),
    deadline: unixSeconds(input.deadline),
  };
}
