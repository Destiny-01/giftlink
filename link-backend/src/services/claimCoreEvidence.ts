import { Contract, JsonRpcProvider } from "ethers";
import type { TransactionReceipt } from "ethers";
import { env } from "../config/env";
import { nomineClaimCoreInterface } from "../config/claimCoreAbi";
import { getRpcProvider } from "../config/arcClient";
import {
  ChainEvidenceError,
  ConfigurationError,
  ValidationError,
} from "../utils/errors";

/**
 * Chain-authoritative verification for Nomine Claim Core.
 *
 * The same discipline as `services/chainEvidence.ts`, applied to the Claim Core contract:
 * D-004 makes the contract's own canonical events authoritative for funding, settlement and
 * recovery, so every fact this module returns is decoded from a log the configured contract
 * emitted - never asserted by a caller. `docs/nomine-claim-core-integration.md` §2/§3 names
 * the three events and nothing else counts as evidence.
 *
 * Two shapes are worth keeping distinct:
 *
 * - **receipt decoders** (`extract*`/`fetchVerified*`) run against a transaction hash the
 *   caller supplied, and reject anything that does not resolve to the named event;
 * - **view reads** (`readOnchainCampaign`, `isEntitlementConsumed`) read the contract's own
 *   record, which is what lets the local database reconcile to the chain rather than to
 *   itself.
 */

export interface CampaignFundingFacts {
  txHash: string;
  blockNumber: number;
  logIndex: number;
  onchainId: bigint;
  issuer: string;
  issuerApprover: string;
  resolver: string;
  allocation: bigint;
  entitlementCount: number;
  fundedAmount: bigint;
  openingTime: bigint;
  expiryTime: bigint;
  entitlementRoot: string;
}

export interface ClaimSettlementFacts {
  txHash: string;
  blockNumber: number;
  logIndex: number;
  onchainId: bigint;
  entitlementId: string;
  wallet: string;
  amount: bigint;
  submitter: string;
}

export interface CampaignReclaimFacts {
  txHash: string;
  blockNumber: number;
  logIndex: number;
  onchainId: bigint;
  issuer: string;
  amount: bigint;
}

export interface OnchainCampaignView {
  issuer: string;
  issuerApprover: string;
  resolver: string;
  allocation: bigint;
  entitlementCount: number;
  settlementCount: number;
  openingTime: bigint;
  expiryTime: bigint;
  entitlementRoot: string;
  reclaimed: boolean;
}

/**
 * How long a successful deployment check is reused, mirroring `chainEvidence.ts`. The
 * immutable `USDC` value cannot change, so the window only bounds how long a wrong address
 * could keep answering, not staleness of a rotating value.
 */
const CONTRACT_VIEW_TTL_MS = 5 * 60 * 1000;

let claimCoreViewCache: { usdcAddress: string; fetchedAt: number } | null = null;

/** Clears the cached deployment check. Used by tests and configuration reloads. */
export function resetClaimCoreViewCache(): void {
  claimCoreViewCache = null;
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Confirms the configured address really is the Claim Core generation this service expects,
 * and that it settles the USDC this service is configured for.
 *
 * The immutable `USDC()` value is the strongest cheap fingerprint available: a different
 * contract at the same address either lacks the function or reports a different token, so a
 * misconfigured address fails closed before any signature is produced or any gas is spent
 * (§1: "Configuration is explicit and fails closed").
 */
export async function assertClaimCoreConfiguration(
  provider: JsonRpcProvider = getRpcProvider()
): Promise<{ usdcAddress: string }> {
  if (
    claimCoreViewCache &&
    Date.now() - claimCoreViewCache.fetchedAt < CONTRACT_VIEW_TTL_MS
  ) {
    return { usdcAddress: claimCoreViewCache.usdcAddress };
  }

  const contract = new Contract(
    env.CLAIM_CORE_CONTRACT_ADDRESS,
    nomineClaimCoreInterface,
    provider
  );

  let usdcAddress: string;
  try {
    usdcAddress = String(await contract.USDC());
  } catch (error) {
    throw new ConfigurationError(
      `The configured contract at ${env.CLAIM_CORE_CONTRACT_ADDRESS} does not answer USDC(). ` +
        "It is probably a different contract generation than link-contracts/contracts/NomineClaimCore.sol, " +
        "or the address/network is wrong. Refusing to authorize anything against it."
    );
  }

  if (
    normalizeAddress(usdcAddress) !== normalizeAddress(env.USDC_CONTRACT_ADDRESS)
  ) {
    throw new ConfigurationError(
      `Deployment mismatch: Claim Core ${env.CLAIM_CORE_CONTRACT_ADDRESS} settles ${usdcAddress}, ` +
        `but USDC_CONTRACT_ADDRESS is ${env.USDC_CONTRACT_ADDRESS}. Refusing to authorize settlements.`
    );
  }

  claimCoreViewCache = {
    usdcAddress: normalizeAddress(usdcAddress),
    fetchedAt: Date.now(),
  };
  return { usdcAddress: claimCoreViewCache.usdcAddress };
}

/**
 * Decodes every log the configured contract emitted in a receipt.
 *
 * A confirmed transaction with no log from the configured contract is rejected outright: a
 * successful receipt is not evidence on its own (§2: the events are "the only canonical
 * evidence").
 */
function decodeContractLogs(
  receipt: TransactionReceipt,
  contractAddress: string
): { name: string; args: Record<string, unknown> & unknown[]; logIndex: number }[] {
  if (!receipt || receipt.status !== 1) {
    throw new ValidationError("Transaction failed or is not confirmed");
  }

  const expected = normalizeAddress(contractAddress);
  const contractLogs = receipt.logs.filter(
    (log) => normalizeAddress(log.address) === expected
  );

  if (contractLogs.length === 0) {
    throw new ChainEvidenceError(
      `Transaction ${receipt.hash} was not emitted by the configured Claim Core contract ` +
        `${contractAddress}. It cannot be used as evidence.`
    );
  }

  const decoded: {
    name: string;
    args: Record<string, unknown> & unknown[];
    logIndex: number;
  }[] = [];

  for (const log of contractLogs) {
    let parsed;
    try {
      parsed = nomineClaimCoreInterface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });
    } catch {
      continue;
    }
    if (!parsed) {
      continue;
    }
    decoded.push({
      name: parsed.name,
      args: parsed.args as unknown as Record<string, unknown> & unknown[],
      logIndex: log.index,
    });
  }

  return decoded;
}

/**
 * Extracts the canonical `CampaignFunded` event emitted by the configured contract.
 *
 * When an `onchainId` is expected, only a funding event naming it is accepted, so a valid
 * funding of some other campaign can never confirm this one.
 */
export function extractCampaignFunded(
  receipt: TransactionReceipt,
  expected: { contractAddress: string; onchainId?: bigint }
): CampaignFundingFacts {
  const matches = decodeContractLogs(receipt, expected.contractAddress).filter(
    (entry) =>
      entry.name === "CampaignFunded" &&
      (expected.onchainId === undefined ||
        BigInt(entry.args.campaignId as bigint) === expected.onchainId)
  );

  if (matches.length === 0) {
    throw new ChainEvidenceError(
      `Transaction ${receipt.hash} contains no CampaignFunded event${
        expected.onchainId !== undefined
          ? ` for campaign ${expected.onchainId.toString()}`
          : ""
      } from the configured contract ${expected.contractAddress}. It cannot confirm this campaign.`
    );
  }

  const entry = matches[0];
  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    logIndex: entry.logIndex,
    onchainId: BigInt(entry.args.campaignId as bigint),
    issuer: normalizeAddress(String(entry.args.issuer)),
    issuerApprover: normalizeAddress(String(entry.args.issuerApprover)),
    resolver: normalizeAddress(String(entry.args.resolver)),
    allocation: BigInt(entry.args.allocation as bigint),
    entitlementCount: Number(entry.args.entitlementCount),
    fundedAmount: BigInt(entry.args.fundedAmount as bigint),
    openingTime: BigInt(entry.args.openingTime as bigint),
    expiryTime: BigInt(entry.args.expiryTime as bigint),
    entitlementRoot: String(entry.args.entitlementRoot),
  };
}

/** Extracts the canonical `Settlement` event, optionally for one entitlement. */
export function extractClaimSettlement(
  receipt: TransactionReceipt,
  expected: { contractAddress: string; onchainId: bigint; entitlementId?: string }
): ClaimSettlementFacts {
  const matches = decodeContractLogs(receipt, expected.contractAddress).filter(
    (entry) =>
      entry.name === "Settlement" &&
      BigInt(entry.args.campaignId as bigint) === expected.onchainId &&
      (expected.entitlementId === undefined ||
        String(entry.args.entitlementId).toLowerCase() ===
          expected.entitlementId.toLowerCase())
  );

  if (matches.length === 0) {
    throw new ChainEvidenceError(
      `Transaction ${receipt.hash} contains no Settlement event for campaign ` +
        `${expected.onchainId.toString()}${
          expected.entitlementId ? ` / entitlement ${expected.entitlementId}` : ""
        }. It does not settle this claim.`
    );
  }

  const entry = matches[0];
  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    logIndex: entry.logIndex,
    onchainId: BigInt(entry.args.campaignId as bigint),
    entitlementId: String(entry.args.entitlementId),
    wallet: normalizeAddress(String(entry.args.wallet)),
    amount: BigInt(entry.args.amount as bigint),
    submitter: normalizeAddress(String(entry.args.submitter)),
  };
}

/** Extracts the canonical `CampaignReclaimed` event for this campaign. */
export function extractCampaignReclaimed(
  receipt: TransactionReceipt,
  expected: { contractAddress: string; onchainId: bigint }
): CampaignReclaimFacts {
  const matches = decodeContractLogs(receipt, expected.contractAddress).filter(
    (entry) =>
      entry.name === "CampaignReclaimed" &&
      BigInt(entry.args.campaignId as bigint) === expected.onchainId
  );

  if (matches.length === 0) {
    throw new ChainEvidenceError(
      `Transaction ${receipt.hash} contains no CampaignReclaimed event for campaign ` +
        `${expected.onchainId.toString()} from the configured contract. It does not reclaim this campaign.`
    );
  }

  const entry = matches[0];
  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    logIndex: entry.logIndex,
    onchainId: BigInt(entry.args.campaignId as bigint),
    issuer: normalizeAddress(String(entry.args.issuer)),
    amount: BigInt(entry.args.amount as bigint),
  };
}

async function receiptFor(
  txHash: string,
  provider: JsonRpcProvider
): Promise<TransactionReceipt> {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new ValidationError(
      "Transaction is not confirmed yet. Evidence is recorded only from a confirmed transaction."
    );
  }
  return receipt;
}

/** Fetches a receipt and verifies it funded this campaign. */
export async function fetchVerifiedCampaignFunding(
  txHash: string,
  expected: {
    contractAddress: string;
    onchainId?: bigint;
    provider?: JsonRpcProvider;
  }
): Promise<CampaignFundingFacts> {
  const provider = expected.provider ?? getRpcProvider();
  return extractCampaignFunded(await receiptFor(txHash, provider), expected);
}

/** Fetches a receipt and verifies it settles this entitlement. */
export async function fetchVerifiedClaimSettlement(
  txHash: string,
  expected: {
    contractAddress: string;
    onchainId: bigint;
    entitlementId?: string;
    provider?: JsonRpcProvider;
  }
): Promise<ClaimSettlementFacts> {
  const provider = expected.provider ?? getRpcProvider();
  return extractClaimSettlement(await receiptFor(txHash, provider), expected);
}

/** Fetches a receipt and verifies it reclaimed this campaign. */
export async function fetchVerifiedCampaignReclaim(
  txHash: string,
  expected: {
    contractAddress: string;
    onchainId: bigint;
    provider?: JsonRpcProvider;
  }
): Promise<CampaignReclaimFacts> {
  const provider = expected.provider ?? getRpcProvider();
  return extractCampaignReclaimed(await receiptFor(txHash, provider), expected);
}

/**
 * Reads the contract's own record of a campaign.
 *
 * This is the authoritative accounting the local database reconciles to. Amounts are
 * derived from the fixed allocation and the settlement count, so they cannot drift from the
 * commitment the issuer funded.
 */
export async function readOnchainCampaign(
  onchainId: bigint,
  provider: JsonRpcProvider = getRpcProvider()
): Promise<OnchainCampaignView> {
  const contract = new Contract(
    env.CLAIM_CORE_CONTRACT_ADDRESS,
    nomineClaimCoreInterface,
    provider
  );

  let campaign;
  try {
    campaign = await contract.getCampaign(onchainId);
  } catch (error) {
    throw new ConfigurationError(
      `Unable to read campaign ${onchainId.toString()} from the configured Claim Core contract ` +
        `${env.CLAIM_CORE_CONTRACT_ADDRESS}. Refusing to proceed against unverifiable chain state.`
    );
  }

  return {
    issuer: normalizeAddress(String(campaign.issuer)),
    issuerApprover: normalizeAddress(String(campaign.issuerApprover)),
    resolver: normalizeAddress(String(campaign.resolver)),
    allocation: BigInt(campaign.allocation),
    entitlementCount: Number(campaign.entitlementCount),
    settlementCount: Number(campaign.settlementCount),
    openingTime: BigInt(campaign.openingTime),
    expiryTime: BigInt(campaign.expiryTime),
    entitlementRoot: String(campaign.entitlementRoot),
    reclaimed: Boolean(campaign.reclaimed),
  };
}

/** The on-chain truth for whether an entitlement is consumed. */
export async function isEntitlementConsumed(
  onchainId: bigint,
  entitlementId: string,
  provider: JsonRpcProvider = getRpcProvider()
): Promise<boolean> {
  const contract = new Contract(
    env.CLAIM_CORE_CONTRACT_ADDRESS,
    nomineClaimCoreInterface,
    provider
  );

  try {
    return Boolean(
      await contract.isEntitlementConsumed(onchainId, entitlementId)
    );
  } catch (error) {
    throw new ConfigurationError(
      `Unable to read consumption for entitlement ${entitlementId} of campaign ` +
        `${onchainId.toString()} from the configured Claim Core contract. ` +
        "Refusing to reconcile against unverifiable chain state."
    );
  }
}

/**
 * Finds the settlement the contract already recorded for an entitlement.
 *
 * This is the reconciliation path: a claim that succeeded on-chain but whose response was
 * lost is recovered from the canonical event rather than submitted a second time.
 */
export async function findSettlementForEntitlement(
  onchainId: bigint,
  entitlementId: string,
  provider: JsonRpcProvider = getRpcProvider(),
  fromBlock: number | string = 0
): Promise<ClaimSettlementFacts | null> {
  const contract = new Contract(
    env.CLAIM_CORE_CONTRACT_ADDRESS,
    nomineClaimCoreInterface,
    provider
  );

  let logs;
  try {
    logs = await contract.queryFilter(
      contract.filters.Settlement(onchainId, entitlementId),
      fromBlock,
      "latest"
    );
  } catch (error) {
    throw new ConfigurationError(
      `Unable to read Settlement events for entitlement ${entitlementId} from the configured Claim Core contract. ` +
        "Refusing to reconcile a claim without chain evidence."
    );
  }

  if (!logs || logs.length === 0) {
    return null;
  }

  const txHash = logs[0].transactionHash;
  return extractClaimSettlement(
    {
      hash: txHash,
      status: 1,
      blockNumber: logs[0].blockNumber,
      logs: logs.filter((log) => log.transactionHash === txHash),
    } as unknown as TransactionReceipt,
    {
      contractAddress: env.CLAIM_CORE_CONTRACT_ADDRESS,
      onchainId,
      entitlementId,
    }
  );
}
