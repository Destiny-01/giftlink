/**
 * Nomine Claim Core - EIP-712 + contract-call helpers.
 *
 * Canonical facts come from `docs/nomine-claim-core-integration.md`. Nothing here may invent a
 * field, a type or a fallback. Configuration fails closed: if the configured chain ID or contract
 * address does not match what we are talking to, callers must refuse to send a transaction rather
 * than silently point somewhere else.
 */

import {
  encodeFunctionData,
  hashTypedData,
  isAddress,
  keccak256,
  concat,
  zeroAddress,
  type TypedDataDomain,
} from "viem";
import { claimCoreAbi } from "@/lib/claimCoreAbi";

// ---------------------------------------------------------------------------
// Deployment constants (spec §1)
// ---------------------------------------------------------------------------

export const CLAIM_CORE_DOMAIN_NAME = "NomineClaimCore";
export const CLAIM_CORE_DOMAIN_VERSION = "1";

export const CLAIM_CORE_CHAIN_ID = Number(
  import.meta.env.VITE_ARC_CHAIN_ID || 5042002
);

export const CLAIM_CORE_EXPLORER_URL =
  (import.meta.env.VITE_ARC_EXPLORER_URL as string) ||
  "https://explorer.testnet.arc.io";

// USDC_DECIMALS and the amount/timestamp formatters live in `./format`, which is free of
// `import.meta.env` and project aliases so a plain runtime test can execute them. They are
// re-exported below, so existing importers of this module keep working unchanged.

/** Arc testnet USDC ERC-20 interface (spec §1). */
export const USDC_ADDRESS = ((import.meta.env.VITE_USDC_CONTRACT_ADDRESS as string) ||
  "0x3600000000000000000000000000000000000000") as `0x${string}`;

// ---------------------------------------------------------------------------
// Config (fails closed)
// ---------------------------------------------------------------------------

export class ClaimCoreNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimCoreNotConfiguredError";
  }
}

export interface ClaimCoreConfig {
  address: `0x${string}`;
  chainId: number;
  usdcAddress: `0x${string}`;
  explorerUrl: string;
}

/**
 * Read the Claim Core config from the environment. VITE_CLAIM_CORE_ADDRESS has no unsafe default:
 * when it is missing or malformed we throw instead of pointing at a legacy contract.
 */
export function getClaimCoreConfig(): ClaimCoreConfig {
  const address = import.meta.env.VITE_CLAIM_CORE_ADDRESS as string | undefined;

  if (!address || !isAddress(address) || address === zeroAddress) {
    throw new ClaimCoreNotConfiguredError(
      "VITE_CLAIM_CORE_ADDRESS is not set to a valid Nomine Claim Core address. Refusing to continue."
    );
  }

  return {
    address: address as `0x${string}`,
    chainId: CLAIM_CORE_CHAIN_ID,
    usdcAddress: USDC_ADDRESS,
    explorerUrl: CLAIM_CORE_EXPLORER_URL,
  };
}

export function isClaimCoreConfigured(): boolean {
  try {
    getClaimCoreConfig();
    return true;
  } catch {
    return false;
  }
}

/**
 * Refuse to transact when the wallet is not on the configured chain, or when a campaign points at a
 * contract other than the one we are configured for.
 */
export function assertClaimCoreChain(walletChainId?: number) {
  const cfg = getClaimCoreConfig();
  if (walletChainId !== undefined && walletChainId !== cfg.chainId) {
    throw new ClaimCoreNotConfiguredError(
      `Wallet is on chain ${walletChainId} but the Claim Core is deployed on chain ${cfg.chainId}. Refusing to send a transaction.`
    );
  }
  return cfg;
}

export function assertCampaignContract(contractAddress?: string) {
  const cfg = getClaimCoreConfig();
  if (
    contractAddress &&
    contractAddress.toLowerCase() !== cfg.address.toLowerCase()
  ) {
    throw new ClaimCoreNotConfiguredError(
      `Campaign contract ${contractAddress} does not match the configured Claim Core ${cfg.address}. Refusing to sign.`
    );
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// EIP-712 domain + types (spec §1, §2, §3)
// ---------------------------------------------------------------------------

export function getClaimCoreDomain(overrides?: {
  chainId?: number;
  verifyingContract?: `0x${string}`;
}): TypedDataDomain {
  const cfg = getClaimCoreConfig();
  return {
    name: CLAIM_CORE_DOMAIN_NAME,
    version: CLAIM_CORE_DOMAIN_VERSION,
    chainId: overrides?.chainId ?? cfg.chainId,
    verifyingContract: overrides?.verifyingContract ?? cfg.address,
  };
}

/**
 * Exact EIP-712 type strings. These must match the on-chain typehashes byte for byte.
 */
export const CLAIM_REQUEST_TYPE_STRING =
  "ClaimRequest(uint256 campaignId,bytes32 entitlementId,address wallet,uint256 amount,uint64 deadline)";

export const APPROVAL_TYPE_STRING =
  "Approval(uint256 campaignId,bytes32 entitlementId,address wallet,uint256 amount,uint64 deadline,bytes32 consentDigest)";

/**
 * Field order is significant and mirrors the on-chain structs.
 */
export const CLAIM_REQUEST_TYPES = {
  ClaimRequest: [
    { name: "campaignId", type: "uint256" },
    { name: "entitlementId", type: "bytes32" },
    { name: "wallet", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const APPROVAL_TYPES = {
  Approval: [
    { name: "campaignId", type: "uint256" },
    { name: "entitlementId", type: "bytes32" },
    { name: "wallet", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "consentDigest", type: "bytes32" },
  ],
} as const;

// ---------------------------------------------------------------------------
// Struct / message shapes
// ---------------------------------------------------------------------------

/** `NomineClaimCore.CampaignConfig` (field order is significant). */
export interface CampaignConfigStruct {
  issuerApprover: `0x${string}`;
  resolver: `0x${string}`;
  allocation: bigint | number | string;
  openingTime: bigint | number | string;
  expiryTime: bigint | number | string;
  entitlementIds: `0x${string}`[];
}

/** Claimant consent message - signs the `ClaimRequest`. */
export interface ClaimRequestMessage {
  campaignId: bigint | number | string;
  entitlementId: `0x${string}`;
  wallet: `0x${string}`;
  amount: bigint | number | string;
  deadline: bigint | number | string;
}

/** Authority attestation message - issuer approver + Resolver sign the same `Approval`. */
export interface ApprovalMessage {
  campaignId: bigint | number | string;
  entitlementId: `0x${string}`;
  wallet: `0x${string}`;
  amount: bigint | number | string;
  deadline: bigint | number | string;
  consentDigest: `0x${string}`;
}

export function buildClaimRequestMessage(input: {
  campaignId: bigint | number | string;
  entitlementId: `0x${string}`;
  wallet: `0x${string}`;
  amount: bigint | number | string;
  deadline: bigint | number | string;
}): ClaimRequestMessage {
  return {
    campaignId: input.campaignId,
    entitlementId: input.entitlementId,
    wallet: input.wallet,
    amount: input.amount,
    deadline: input.deadline,
  };
}

export function buildApprovalMessage(
  request: ClaimRequestMessage,
  consentDigest: `0x${string}`
): ApprovalMessage {
  return {
    campaignId: request.campaignId,
    entitlementId: request.entitlementId,
    wallet: request.wallet,
    amount: request.amount,
    deadline: request.deadline,
    consentDigest,
  };
}

// ---------------------------------------------------------------------------
// Consent digest derivation (spec §3)
// ---------------------------------------------------------------------------

/**
 * digest = _hashTypedDataV4(hashStruct(ClaimRequest))
 * Equivalent to ethers `TypedDataEncoder.hash(domain, types, request)`.
 */
export function claimRequestDigest(
  request: ClaimRequestMessage,
  domain?: TypedDataDomain
): `0x${string}` {
  return hashTypedData({
    domain: domain ?? getClaimCoreDomain(),
    types: CLAIM_REQUEST_TYPES,
    primaryType: "ClaimRequest",
    // viem requires real bigints for uint256/uint64; the view model carries them as
    // strings or numbers, so normalize here rather than letting viem reject the payload.
    message: {
      campaignId: BigInt(request.campaignId),
      entitlementId: request.entitlementId,
      wallet: request.wallet,
      amount: BigInt(request.amount),
      deadline: BigInt(request.deadline),
    },
  });
}

export function approvalDigest(
  approval: ApprovalMessage,
  domain?: TypedDataDomain
): `0x${string}` {
  return hashTypedData({
    domain: domain ?? getClaimCoreDomain(),
    types: APPROVAL_TYPES,
    primaryType: "Approval",
    message: {
      campaignId: BigInt(approval.campaignId),
      entitlementId: approval.entitlementId,
      wallet: approval.wallet,
      amount: BigInt(approval.amount),
      deadline: BigInt(approval.deadline),
      consentDigest: approval.consentDigest,
    },
  });
}

export interface SignableTypedData {
  domain: TypedDataDomain;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

export function getClaimConsentTypedData(
  request: ClaimRequestMessage,
  domain?: TypedDataDomain
): SignableTypedData {
  return {
    domain: domain ?? getClaimCoreDomain(),
    types: CLAIM_REQUEST_TYPES as unknown as SignableTypedData["types"],
    primaryType: "ClaimRequest",
    message: request as unknown as Record<string, unknown>,
  };
}

export function getApprovalTypedData(
  approval: ApprovalMessage,
  domain?: TypedDataDomain
): SignableTypedData {
  return {
    domain: domain ?? getClaimCoreDomain(),
    types: APPROVAL_TYPES as unknown as SignableTypedData["types"],
    primaryType: "Approval",
    message: approval as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Entitlement identifiers + membership commitment (spec §4)
// ---------------------------------------------------------------------------

/** Order-independent pair hashing: keccak256(sorted(a, b)). */
export function hashPair(a: `0x${string}`, b: `0x${string}`): `0x${string}` {
  const [lo, hi] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(concat([lo, hi]));
}

/** leaf(id) = keccak256(id). Entitlement ids are 32 random bytes, never derived from an email. */
export function entitlementLeaf(id: `0x${string}`): `0x${string}` {
  return keccak256(id);
}

/** Strictly ascending byte order - the single constraint the contract enforces. */
export function sortEntitlementIds(ids: `0x${string}`[]): `0x${string}`[] {
  return [...ids].sort((a, b) =>
    a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0
  );
}

/**
 * Merkle root over leaf(id) = keccak256(id), with last node of an odd level promoted unchanged.
 */
export function computeEntitlementRoot(ids: `0x${string}`[]): `0x${string}` {
  if (ids.length === 0) {
    throw new Error("Cannot compute an entitlement root for an empty set");
  }
  let level = sortEntitlementIds(ids).map(entitlementLeaf);
  while (level.length > 1) {
    const next: `0x${string}`[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) {
        next.push(level[i]);
      } else {
        next.push(hashPair(level[i], level[i + 1]));
      }
    }
    level = next;
  }
  return level[0];
}

/** Merkle proof for a single leaf. Settlement proves the leaf, not internal nodes. */
export function computeEntitlementProof(
  ids: `0x${string}`[],
  id: `0x${string}`
): `0x${string}`[] {
  const sorted = sortEntitlementIds(ids);
  let index = sorted.findIndex(
    (candidate) => candidate.toLowerCase() === id.toLowerCase()
  );
  if (index === -1) {
    throw new Error("Entitlement id is not part of the set");
  }

  let level = sorted.map(entitlementLeaf);
  const proof: `0x${string}`[] = [];

  while (level.length > 1) {
    const pairIndex = index % 2 === 0 ? index + 1 : index - 1;
    if (pairIndex < level.length) {
      proof.push(level[pairIndex]);
    }
    const next: `0x${string}`[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) {
        next.push(level[i]);
      } else {
        next.push(hashPair(level[i], level[i + 1]));
      }
    }
    level = next;
    index = Math.floor(index / 2);
  }

  return proof;
}

// ---------------------------------------------------------------------------
// Contract call builders (spec §2)
// ---------------------------------------------------------------------------

export interface ContractCall {
  address: `0x${string}`;
  abi: typeof claimCoreAbi;
  functionName: "createCampaign" | "settle" | "reclaim";
  args: readonly unknown[];
}

export function buildCreateCampaignCall(
  config: CampaignConfigStruct,
  address?: `0x${string}`
): ContractCall {
  return {
    address: address ?? getClaimCoreConfig().address,
    abi: claimCoreAbi,
    functionName: "createCampaign",
    args: [config],
  };
}

export function buildSettleCall(
  args: {
    request: ClaimRequestMessage;
    claimantSignature: `0x${string}`;
    approval: ApprovalMessage;
    issuerApprovalSignature: `0x${string}`;
    resolverApprovalSignature: `0x${string}`;
    entitlementProof: `0x${string}`[];
  },
  address?: `0x${string}`
): ContractCall {
  return {
    address: address ?? getClaimCoreConfig().address,
    abi: claimCoreAbi,
    functionName: "settle",
    args: [
      args.request,
      args.claimantSignature,
      args.approval,
      args.issuerApprovalSignature,
      args.resolverApprovalSignature,
      args.entitlementProof,
    ],
  };
}

export function buildReclaimCall(
  campaignId: bigint | number | string,
  address?: `0x${string}`
): ContractCall {
  return {
    address: address ?? getClaimCoreConfig().address,
    abi: claimCoreAbi,
    functionName: "reclaim",
    args: [campaignId],
  };
}

// ---------------------------------------------------------------------------
// Encoded calldata helpers
// ---------------------------------------------------------------------------

export function encodeCreateCampaignData(config: CampaignConfigStruct): `0x${string}` {
  return encodeFunctionData(buildCreateCampaignCall(config) as never);
}

export function encodeSettleData(args: {
  request: ClaimRequestMessage;
  claimantSignature: `0x${string}`;
  approval: ApprovalMessage;
  issuerApprovalSignature: `0x${string}`;
  resolverApprovalSignature: `0x${string}`;
  entitlementProof: `0x${string}`[];
}): `0x${string}` {
  return encodeFunctionData(buildSettleCall(args) as never);
}

export function encodeReclaimData(campaignId: bigint | number | string): `0x${string}` {
  return encodeFunctionData(buildReclaimCall(campaignId) as never);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export {
  USDC_DECIMALS,
  usdcToBaseUnits,
  formatUsdc,
  formatUsdcDisplay,
  formatTimestampWithTimezone,
} from "./format";

export function explorerTxUrl(txHash?: string | null): string | null {
  if (!txHash) return null;
  return `${CLAIM_CORE_EXPLORER_URL}/tx/${txHash}`;
}

export function explorerAddressUrl(address?: string | null): string | null {
  if (!address) return null;
  return `${CLAIM_CORE_EXPLORER_URL}/address/${address}`;
}

export function shortenAddress(address?: string | null, size = 4): string {
  if (!address) return "—";
  if (address.length <= size * 2 + 2) return address;
  return `${address.slice(0, 2 + size)}…${address.slice(-size)}`;
}

/** Absolute unix-seconds deadline, never later than the campaign expiry. */
export function defaultConsentDeadline(expiryTime?: number | null, windowSeconds = 3600): number {
  const now = Math.floor(Date.now() / 1000);
  const proposed = now + windowSeconds;
  if (expiryTime && expiryTime > 0) {
    return Math.min(proposed, expiryTime);
  }
  return proposed;
}

export const claimCore = {
  abi: claimCoreAbi,
  domainName: CLAIM_CORE_DOMAIN_NAME,
  domainVersion: CLAIM_CORE_DOMAIN_VERSION,
};
