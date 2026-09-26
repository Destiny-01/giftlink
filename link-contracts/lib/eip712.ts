import { ethers } from "ethers";

export const CLAIM_REQUEST_TYPES = {
  ClaimRequest: [
    { name: "campaignId", type: "uint256" },
    { name: "entitlementId", type: "bytes32" },
    { name: "wallet", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
};

export const APPROVAL_TYPES = {
  Approval: [
    { name: "campaignId", type: "uint256" },
    { name: "entitlementId", type: "bytes32" },
    { name: "wallet", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "consentDigest", type: "bytes32" },
  ],
};

export interface DomainOverrides {
  chainId?: number;
  verifyingContract?: string;
  name?: string;
  version?: string;
}

export function domain(chainId: number, verifyingContract: string, overrides: DomainOverrides = {}) {
  return {
    name: overrides.name ?? "NomineClaimCore",
    version: overrides.version ?? "1",
    chainId: overrides.chainId ?? chainId,
    verifyingContract: overrides.verifyingContract ?? verifyingContract,
  };
}

/**
 * The digest the claimant signs. Mirrors the contract exactly but is computed
 * independently through ethers, so the tests exercise the real EIP-712 encoding
 * rather than echoing a value the contract handed back.
 */
export function consentDigest(
  signerDomain: ReturnType<typeof domain>,
  request: {
    campaignId: bigint;
    entitlementId: string;
    wallet: string;
    amount: bigint;
    deadline: bigint;
  },
): string {
  return ethers.TypedDataEncoder.hash(signerDomain, CLAIM_REQUEST_TYPES, request);
}

export function approvalDigestFor(
  signerDomain: ReturnType<typeof domain>,
  approval: {
    campaignId: bigint;
    entitlementId: string;
    wallet: string;
    amount: bigint;
    deadline: bigint;
    consentDigest: string;
  },
): string {
  return ethers.TypedDataEncoder.hash(signerDomain, APPROVAL_TYPES, approval);
}
