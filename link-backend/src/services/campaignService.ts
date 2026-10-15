import type { Campaign, ClaimRequest, Entitlement } from "@prisma/client";
import { CampaignStatus, ClaimEventType } from "@prisma/client";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { backendSigner } from "../config/wallets";
import { getRpcProvider } from "../config/arcClient";
import { logger } from "../config/logger";
import { errorDiagnostics } from "../utils/safeLog";
import {
  campaignBudget,
  campaignParamsHash,
  eligibilityEmailHash,
  emailHashFromNormalized,
  entitlementRoot,
  generateEntitlementId,
  normalizeVerifiedEmail,
  sortEntitlementIds,
  unixSeconds,
} from "../utils/claimCore";
import {
  ChainEvidenceError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../utils/errors";
import type { AuthenticatedUser } from "../middleware/auth";
import { assertConfiguredNetwork, getBlockTimestamp } from "./chainEvidence";
import {
  assertCampaignWithinLimits,
  assertIssuerAllowlisted,
} from "./studioAccess";
import {
  assertClaimCoreConfiguration,
  fetchVerifiedCampaignFunding,
  fetchVerifiedCampaignReclaim,
  readOnchainCampaign,
} from "./claimCoreEvidence";
import { approvalModeOf } from "./claimRequestService";
import type {
  CampaignAccountingResponse,
  CampaignPublicViewResponse,
  InboxEntryResponse,
  PrepareCampaignRequest,
  PrepareCampaignResponse,
} from "../dto/campaign.dto";

/**
 * Campaign lifecycle for Nomine Claim Core (`docs/nomine-claim-core-integration.md` §8).
 *
 * Everything the issuer does before money moves (prepare, fund, list, reclaim) lives here.
 * The contract's canonical events are the only evidence accepted: a funding confirmation is
 * checked field by field against the prepared configuration and the committed params hash,
 * and a reclaim is checked against `CampaignReclaimed`. Ownership is anchored on the
 * authenticated issuer, never on anything the caller asserts.
 */

type CampaignWithEntitlements = Campaign & { entitlements: Entitlement[] };

function requirePrivyId(authUser?: AuthenticatedUser): string {
  if (!authUser?.privyUserId) {
    throw new UnauthorizedError("Authenticated user is required");
  }
  return authUser.privyUserId;
}

// ---------------------------------------------------------------------------
// Prepare
// ---------------------------------------------------------------------------

/**
 * Normalizes and dedups the roster, assigns one opaque identifier per recipient, persists
 * the campaign as `DRAFT`, and returns the exact `CampaignConfig` the funding wallet must
 * submit.
 *
 * Identifiers are 32 random bytes each (§4): never derived from an email, never a public
 * hash of one. Emails themselves are reduced to `HMAC-SHA256(SERVER_PEPPER, normalizedEmail)`
 * and the raw address is discarded (§5, D-008).
 */
export async function prepareCampaign(
  input: PrepareCampaignRequest,
  authUser?: AuthenticatedUser
): Promise<PrepareCampaignResponse> {
  const issuerPrivyId = requirePrivyId(authUser);
  assertIssuerAllowlisted(issuerPrivyId);

  const issuerAddress = authUser?.walletAddresses?.[0]?.toLowerCase();
  if (!issuerAddress) {
    throw new ForbiddenError(
      "Link the wallet that will fund this campaign, then prepare it again."
    );
  }

  const resolver = backendSigner.address.toLowerCase();
  // The approver is either the issuer's own key (manual mode) or, when omitted, the Nomine
  // auto-approver (auto mode, D-021). Without the latter and without an explicit address
  // there is nothing to configure at funding time, so the issuer is asked for one.
  const requestedApprover = input.issuerApproverAddress?.toLowerCase() ?? null;
  const configuredAutoApprover = env.AUTO_APPROVER_ADDRESS?.toLowerCase() ?? null;
  const issuerApprover = requestedApprover ?? configuredAutoApprover;
  if (!issuerApprover) {
    throw new ValidationError(
      "Provide an issuer approver address, or configure the Nomine auto-approver " +
        "(AUTO_APPROVER_ADDRESS) to approve automatically."
    );
  }

  // The contract requires the three roles to be distinct at funding time; catching it here
  // gives the issuer a clear message instead of a raw `AuthoritiesNotDistinct` revert.
  if (issuerApprover === resolver) {
    throw new ValidationError(
      "The issuer approver must be a different key than the Nomine Resolver."
    );
  }
  if (issuerApprover === issuerAddress) {
    throw new ValidationError(
      "The issuer approver must be a different key than the funding wallet."
    );
  }

  const allocation = input.allocation;
  if (BigInt(allocation) <= 0n) {
    throw new ValidationError("Allocation must be greater than zero");
  }

  const openingTime = Math.floor(input.openingTime);
  const expiryTime = Math.floor(input.expiryTime);
  if (expiryTime <= openingTime) {
    throw new ValidationError("expiryTime must be after openingTime");
  }
  if (expiryTime <= Math.floor(Date.now() / 1000)) {
    throw new ValidationError("expiryTime must be in the future");
  }

  // Normalize + dedup by hash, then assign one identifier per distinct recipient. The normalized
  // address is held in memory only to build the issuer's private export below; it is never stored.
  const assigned = new Map<string, { entitlementId: string; email: string }>();
  for (const raw of input.emails) {
    const normalized = normalizeVerifiedEmail(raw);
    if (!normalized) {
      continue;
    }
    const emailHash = emailHashFromNormalized(normalized);
    if (!assigned.has(emailHash)) {
      assigned.set(emailHash, { entitlementId: generateEntitlementId(), email: normalized });
    }
  }
  if (assigned.size === 0) {
    throw new ValidationError("At least one recipient email is required");
  }

  assertCampaignWithinLimits(assigned.size, allocation);

  const entitlements = [...assigned.entries()].map(([emailHash, entry]) => ({
    entitlementId: entry.entitlementId,
    emailHash,
  }));

  const entitlementIds = sortEntitlementIds(
    entitlements.map((entry) => entry.entitlementId)
  );
  const root = entitlementRoot(entitlementIds);
  const entitlementCount = entitlementIds.length;
  const budget = campaignBudget(allocation, entitlementCount);

  const paramsHash = campaignParamsHash({
    issuerApprover,
    resolver,
    allocation,
    openingTime,
    expiryTime,
    entitlementCount,
    entitlementRoot: root,
  });

  const campaign = await prisma.campaign.create({
    data: {
      chainId: env.CHAIN_ID,
      contractAddress: env.CLAIM_CORE_CONTRACT_ADDRESS.toLowerCase(),
      issuerPrivyId,
      issuerAddress,
      issuerApproverAddress: issuerApprover,
      resolverAddress: resolver,
      allocation,
      entitlementCount,
      paramsHash,
      openingTime: new Date(openingTime * 1000),
      expiryTime: new Date(expiryTime * 1000),
      status: CampaignStatus.DRAFT,
      entitlements: { create: entitlements },
    },
  });

  logger.info(
    {
      operation: "prepareCampaign",
      outcome: "prepared",
      campaignId: campaign.id,
      entitlementCount,
    },
    "Campaign prepared as DRAFT"
  );

  return {
    campaignId: campaign.id,
    config: {
      issuerApprover,
      resolver,
      allocation,
      openingTime,
      expiryTime,
      entitlementIds,
    },
    entitlementCount,
    budget,
    entitlementRoot: root,
    paramsHash,
    status: CampaignStatus.DRAFT,
    // Returned once, to the authenticated issuer, and never persisted or logged here: the issuer
    // must retain this recipient-to-entitlement mapping outside Nomine so that it can verify a
    // wallet assignment independently later (issue #13 §3). Nomine keeps only the salted hash.
    mapping: [...assigned.values()].map((entry) => ({
      entitlementId: entry.entitlementId,
      email: entry.email,
    })),
  };
}

// ---------------------------------------------------------------------------
// Confirm funding
// ---------------------------------------------------------------------------

/**
 * Binds a prepared campaign to the campaign the chain actually funded.
 *
 * The binding comes from the contract's own `CampaignFunded` event, and the funded campaign
 * must agree with every stored field - count, allocation, root, approver, resolver and both
 * times - plus the committed params hash. Only then is the onchain id recorded and the
 * status advanced to `FUNDED`. Idempotent: repeating the same confirmation converges, a
 * different funding transaction is rejected rather than rebinding.
 */
export async function confirmCampaignFunding(
  campaignId: string,
  txHash: string,
  authUser?: AuthenticatedUser
): Promise<{
  campaignId: string;
  onchainId: string;
  status: string;
  fundingTxHash: string;
}> {
  const issuerPrivyId = requirePrivyId(authUser);

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { entitlements: true },
  });
  if (!campaign) {
    throw new NotFoundError("Campaign not found");
  }
  if (campaign.issuerPrivyId !== issuerPrivyId) {
    throw new ForbiddenError("Only the issuer can confirm this campaign");
  }

  if (campaign.status === CampaignStatus.FUNDED && campaign.fundingTxHash === txHash) {
    return {
      campaignId: campaign.id,
      onchainId: campaign.onchainId?.toString() ?? "",
      status: campaign.status,
      fundingTxHash: txHash,
    };
  }
  if (campaign.fundingTxHash && campaign.fundingTxHash !== txHash) {
    throw new ChainEvidenceError(
      `This campaign is already funded by transaction ${campaign.fundingTxHash}. ` +
        `Refusing to rebind it to ${txHash}.`
    );
  }

  const provider = getRpcProvider();
  await assertConfiguredNetwork(provider);
  await assertClaimCoreConfiguration(provider);

  const facts = await fetchVerifiedCampaignFunding(txHash, {
    contractAddress: env.CLAIM_CORE_CONTRACT_ADDRESS,
    onchainId: campaign.onchainId ?? undefined,
  });

  const localRoot = entitlementRoot(
    campaign.entitlements.map((entitlement) => entitlement.entitlementId)
  );
  const expectedOpening = unixSeconds(campaign.openingTime);
  const expectedExpiry = unixSeconds(campaign.expiryTime);
  const expectedFunded = BigInt(
    campaignBudget(campaign.allocation, campaign.entitlementCount)
  );

  const disagreements: string[] = [];
  if (facts.entitlementCount !== campaign.entitlementCount) {
    disagreements.push("entitlement count");
  }
  if (facts.allocation !== BigInt(campaign.allocation)) {
    disagreements.push("allocation");
  }
  if (facts.entitlementRoot.toLowerCase() !== localRoot.toLowerCase()) {
    disagreements.push("entitlement root");
  }
  if (facts.issuerApprover !== campaign.issuerApproverAddress.toLowerCase()) {
    disagreements.push("issuer approver");
  }
  if (facts.resolver !== campaign.resolverAddress.toLowerCase()) {
    disagreements.push("resolver");
  }
  if (Number(facts.openingTime) !== expectedOpening) {
    disagreements.push("opening time");
  }
  if (Number(facts.expiryTime) !== expectedExpiry) {
    disagreements.push("expiry time");
  }
  if (facts.fundedAmount !== expectedFunded) {
    disagreements.push("funded amount");
  }

  if (disagreements.length > 0) {
    throw new ChainEvidenceError(
      `Transaction ${txHash} funded a campaign that does not match this one ` +
        `(${disagreements.join(", ")}). Refusing to bind them.`
    );
  }

  const linkedWallets = (authUser?.walletAddresses ?? []).map((address) =>
    address.toLowerCase()
  );
  if (!linkedWallets.includes(facts.issuer)) {
    throw new ForbiddenError(
      `This campaign was funded by ${facts.issuer}, which is not linked to your account. ` +
        "Link the funding wallet, or confirm from the account that funded it."
    );
  }

  const eventParamsHash = campaignParamsHash({
    issuerApprover: facts.issuerApprover,
    resolver: facts.resolver,
    allocation: facts.allocation.toString(),
    openingTime: Number(facts.openingTime),
    expiryTime: Number(facts.expiryTime),
    entitlementCount: facts.entitlementCount,
    entitlementRoot: facts.entitlementRoot,
  });
  if (eventParamsHash.toLowerCase() !== campaign.paramsHash.toLowerCase()) {
    throw new ChainEvidenceError(
      `Transaction ${txHash} does not match the prepared configuration for this campaign ` +
        "(params hash mismatch). Refusing to bind them."
    );
  }

  const conflict = await prisma.campaign.findFirst({
    where: {
      chainId: env.CHAIN_ID,
      contractAddress: campaign.contractAddress,
      onchainId: facts.onchainId,
      NOT: { id: campaign.id },
    },
    select: { id: true },
  });
  if (conflict) {
    throw new ChainEvidenceError(
      `On-chain campaign ${facts.onchainId.toString()} is already bound to another campaign. ` +
        "Refusing to create a duplicate binding."
    );
  }

  const blockTimestamp = await getBlockTimestamp(facts.blockNumber, provider);

  const outcome = await prisma.$transaction(async (tx) => {
    // Single conditional UPDATE: exactly one caller can move DRAFT -> FUNDED for this
    // evidence. A concurrent retry blocks on the row lock and then fails the predicate.
    const updated = await tx.campaign.updateMany({
      where: { id: campaign.id, status: CampaignStatus.DRAFT },
      data: {
        onchainId: facts.onchainId,
        fundingTxHash: facts.txHash,
        status: CampaignStatus.FUNDED,
        issuerAddress: facts.issuer,
        updatedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      const current = await tx.campaign.findUnique({
        where: { id: campaign.id },
        select: { fundingTxHash: true },
      });
      if (current?.fundingTxHash === facts.txHash) {
        return "converged";
      }
      throw new ChainEvidenceError(
        "Campaign funding was confirmed concurrently with different evidence."
      );
    }

    await tx.claimEvent.upsert({
      where: { txHash_logIndex: { txHash: facts.txHash, logIndex: facts.logIndex } },
      update: {},
      create: {
        chainId: env.CHAIN_ID,
        contractAddress: campaign.contractAddress,
        eventType: ClaimEventType.CAMPAIGN_FUNDED,
        campaignId: campaign.id,
        onchainCampaignId: facts.onchainId,
        amount: facts.fundedAmount.toString(),
        txHash: facts.txHash,
        logIndex: facts.logIndex,
        blockNumber: BigInt(facts.blockNumber),
        blockTimestamp,
        metadata: {
          entitlementCount: facts.entitlementCount,
          allocation: facts.allocation.toString(),
          entitlementRoot: facts.entitlementRoot,
        },
      },
    });

    return "recorded";
  });

  logger.info(
    {
      operation: "confirmCampaignFunding",
      outcome,
      campaignId: campaign.id,
      onchainId: facts.onchainId.toString(),
      txHash: facts.txHash,
    },
    "Campaign funding confirmed against chain evidence"
  );

  return {
    campaignId: campaign.id,
    onchainId: facts.onchainId.toString(),
    status: CampaignStatus.FUNDED,
    fundingTxHash: facts.txHash,
  };
}

// ---------------------------------------------------------------------------
// Accounting and views
// ---------------------------------------------------------------------------

function localAccounting(campaign: CampaignWithEntitlements): CampaignAccountingResponse {
  const allocation = BigInt(campaign.allocation);
  const consumption = campaign.entitlements.filter(
    (entitlement) => entitlement.consumedAt !== null
  ).length;
  const budget = allocation * BigInt(campaign.entitlementCount);
  const settled = allocation * BigInt(consumption);
  const remaining = budget - settled;
  const reclaimed = campaign.status === CampaignStatus.RECLAIMED;

  return {
    budget: budget.toString(),
    settled: settled.toString(),
    remaining: remaining.toString(),
    reclaimable: reclaimed ? "0" : remaining.toString(),
    settlementCount: consumption,
    reclaimed,
    source: "local",
  };
}

/**
 * Chain totals where the chain is reachable, local totals otherwise.
 *
 * The chain is authoritative (D-004), so `getCampaign` wins when it answers. A failure is
 * non-fatal for a read: the fallback is the same accounting derived from the committed
 * allocation and the consumed entitlements, and the source is reported so the caller can
 * see which one it got.
 */
async function campaignAccounting(
  campaign: CampaignWithEntitlements
): Promise<CampaignAccountingResponse> {
  const local = localAccounting(campaign);
  if (campaign.onchainId === null || campaign.onchainId === undefined) {
    return local;
  }

  try {
    const view = await readOnchainCampaign(campaign.onchainId);
    const budget = view.allocation * BigInt(view.entitlementCount);
    const settled = view.allocation * BigInt(view.settlementCount);
    const remaining = budget - settled;

    return {
      budget: budget.toString(),
      settled: settled.toString(),
      remaining: remaining.toString(),
      reclaimable: view.reclaimed ? "0" : remaining.toString(),
      settlementCount: view.settlementCount,
      reclaimed: view.reclaimed,
      source: "chain",
    };
  } catch (error) {
    logger.warn(
      {
        operation: "campaignAccounting",
        outcome: "chain_unavailable",
        campaignId: campaign.id,
        ...errorDiagnostics(error),
      },
      "Falling back to local accounting for this campaign"
    );
    return local;
  }
}

function mapCampaignSummary(
  campaign: CampaignWithEntitlements,
  accounting: CampaignAccountingResponse
) {
  const consumedCount = campaign.entitlements.filter(
    (entitlement) => entitlement.consumedAt !== null
  ).length;

  return {
    id: campaign.id,
    chainId: campaign.chainId,
    contractAddress: campaign.contractAddress,
    onchainId: campaign.onchainId?.toString() ?? null,
    status: campaign.status,
    allocation: campaign.allocation,
    entitlementCount: campaign.entitlementCount,
    consumedCount,
    openingTime: campaign.openingTime.toISOString(),
    expiryTime: campaign.expiryTime.toISOString(),
    issuerAddress: campaign.issuerAddress,
    issuerApproverAddress: campaign.issuerApproverAddress,
    resolverAddress: campaign.resolverAddress,
    approvalMode: approvalModeOf(campaign),
    fundingTxHash: campaign.fundingTxHash,
    reclaimedTxHash: campaign.reclaimedTxHash,
    accounting,
    createdAt: campaign.createdAt.toISOString(),
  };
}

/** The public link view: no roster, no identities, only what a claim link needs (§8). */
export function campaignPublicView(
  campaign: Pick<
    Campaign,
    | "id"
    | "chainId"
    | "contractAddress"
    | "onchainId"
    | "issuerAddress"
    | "issuerApproverAddress"
    | "resolverAddress"
    | "allocation"
    | "entitlementCount"
    | "status"
    | "openingTime"
    | "expiryTime"
    | "fundingTxHash"
  >
): CampaignPublicViewResponse {
  const fundingStatus =
    campaign.status === CampaignStatus.DRAFT
      ? "awaiting_funding"
      : campaign.status === CampaignStatus.RECLAIMED
        ? "reclaimed"
        : "funded";

  return {
    id: campaign.id,
    chainId: campaign.chainId,
    contractAddress: campaign.contractAddress,
    onchainId: campaign.onchainId?.toString() ?? null,
    issuerAddress: campaign.issuerAddress,
    issuerApproverAddress: campaign.issuerApproverAddress,
    resolverAddress: campaign.resolverAddress,
    approvalMode: approvalModeOf(campaign),
    allocation: campaign.allocation,
    entitlementCount: campaign.entitlementCount,
    budget: campaignBudget(campaign.allocation, campaign.entitlementCount),
    status: campaign.status,
    fundingStatus,
    fundingTxHash: campaign.fundingTxHash,
    openingTime: campaign.openingTime.toISOString(),
    expiryTime: campaign.expiryTime.toISOString(),
    usdcAddress: env.USDC_CONTRACT_ADDRESS.toLowerCase(),
    usdcDecimals: 6,
    recovery:
      "Unused funds are returned to the issuer after expiry by an issuer-only reclaim; recovery needs no approver.",
  };
}

/** The authenticated issuer's campaigns, with chain totals. */
export async function listIssuerCampaigns(authUser?: AuthenticatedUser) {
  const issuerPrivyId = requirePrivyId(authUser);

  const campaigns = await prisma.campaign.findMany({
    where: { issuerPrivyId },
    orderBy: { createdAt: "desc" },
    include: { entitlements: true },
  });

  const mapped = await Promise.all(
    campaigns.map(async (campaign) =>
      mapCampaignSummary(campaign, await campaignAccounting(campaign))
    )
  );

  return { campaigns: mapped };
}

/** Issuer-only detail: private roster summary and accounting, never a raw email or roster. */
export async function getIssuerCampaign(
  campaignId: string,
  authUser?: AuthenticatedUser
) {
  const issuerPrivyId = requirePrivyId(authUser);

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { entitlements: true },
  });
  if (!campaign) {
    throw new NotFoundError("Campaign not found");
  }
  if (campaign.issuerPrivyId !== issuerPrivyId) {
    throw new ForbiddenError("Only the issuer can view this campaign");
  }

  const accounting = await campaignAccounting(campaign);
  const consumedCount = campaign.entitlements.filter(
    (entitlement) => entitlement.consumedAt !== null
  ).length;

  return {
    ...mapCampaignSummary(campaign, accounting),
    roster: {
      total: campaign.entitlementCount,
      consumed: consumedCount,
      remaining: campaign.entitlementCount - consumedCount,
    },
  };
}

/** Issuer-only approval requests: consent + wallet + amount + deadline (§8). */
export async function listCampaignRequests(
  campaignId: string,
  authUser?: AuthenticatedUser
) {
  const issuerPrivyId = requirePrivyId(authUser);

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, issuerPrivyId: true },
  });
  if (!campaign) {
    throw new NotFoundError("Campaign not found");
  }
  if (campaign.issuerPrivyId !== issuerPrivyId) {
    throw new ForbiddenError("Only the issuer can view these requests");
  }

  const requests = await prisma.claimRequest.findMany({
    where: { campaignId },
    orderBy: { createdAt: "desc" },
  });

  return {
    requests: requests.map((request: ClaimRequest) => ({
      requestId: request.id,
      entitlementId: request.entitlementId,
      walletAddress: request.walletAddress,
      amount: request.amount,
      deadline: unixSeconds(request.deadline),
      status: request.status,
      consentDigest: request.consentDigest,
      hasIssuerApproval: request.issuerApprovalSignature !== null,
      submitTxHash: request.submitTxHash,
      settlementTxHash: request.settlementTxHash,
      createdAt: request.createdAt.toISOString(),
    })),
  };
}

/** Public link view. No authentication, no roster (§8). */
export async function getPublicCampaign(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      chainId: true,
      contractAddress: true,
      onchainId: true,
      issuerAddress: true,
      issuerApproverAddress: true,
      resolverAddress: true,
      allocation: true,
      entitlementCount: true,
      status: true,
      openingTime: true,
      expiryTime: true,
      fundingTxHash: true,
    },
  });
  if (!campaign) {
    throw new NotFoundError("Campaign not found");
  }
  return campaignPublicView(campaign);
}

// ---------------------------------------------------------------------------
// Reclaim
// ---------------------------------------------------------------------------

/**
 * Confirms an expiry recovery from the canonical `CampaignReclaimed` event.
 *
 * Recovery depends on neither Gate attestation nor claimant consent (§8, §7): the only
 * requirement is that the caller is the issuer and the event names this campaign and this
 * issuer. Idempotent on the same transaction.
 */
export async function confirmCampaignReclaim(
  campaignId: string,
  txHash: string,
  authUser?: AuthenticatedUser
): Promise<{ campaignId: string; status: string; reclaimedTxHash: string; amount: string }> {
  const issuerPrivyId = requirePrivyId(authUser);

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new NotFoundError("Campaign not found");
  }
  if (campaign.issuerPrivyId !== issuerPrivyId) {
    throw new ForbiddenError("Only the issuer can confirm recovery");
  }

  if (campaign.status === CampaignStatus.RECLAIMED && campaign.reclaimedTxHash === txHash) {
    return {
      campaignId: campaign.id,
      status: campaign.status,
      reclaimedTxHash: txHash,
      amount: "0",
    };
  }
  if (campaign.onchainId === null || campaign.onchainId === undefined) {
    throw new ValidationError("Campaign is not funded on-chain yet");
  }

  const provider = getRpcProvider();
  await assertConfiguredNetwork(provider);
  await assertClaimCoreConfiguration(provider);

  const facts = await fetchVerifiedCampaignReclaim(txHash, {
    contractAddress: env.CLAIM_CORE_CONTRACT_ADDRESS,
    onchainId: campaign.onchainId,
  });

  if (facts.issuer !== campaign.issuerAddress.toLowerCase()) {
    throw new ChainEvidenceError(
      `Transaction ${txHash} reclaimed campaign ${campaign.onchainId.toString()} to ${facts.issuer}, ` +
        `not ${campaign.issuerAddress}. Refusing to record it against this campaign.`
    );
  }

  const blockTimestamp = await getBlockTimestamp(facts.blockNumber, provider);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.campaign.updateMany({
      where: { id: campaign.id, status: { not: CampaignStatus.RECLAIMED } },
      data: {
        status: CampaignStatus.RECLAIMED,
        reclaimedTxHash: facts.txHash,
        updatedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      const current = await tx.campaign.findUnique({
        where: { id: campaign.id },
        select: { reclaimedTxHash: true },
      });
      if (current?.reclaimedTxHash === facts.txHash) {
        return;
      }
      throw new ChainEvidenceError(
        "Campaign recovery was confirmed concurrently with different evidence."
      );
    }

    await tx.claimEvent.upsert({
      where: { txHash_logIndex: { txHash: facts.txHash, logIndex: facts.logIndex } },
      update: {},
      create: {
        chainId: env.CHAIN_ID,
        contractAddress: campaign.contractAddress,
        eventType: ClaimEventType.CAMPAIGN_RECLAIMED,
        campaignId: campaign.id,
        onchainCampaignId: facts.onchainId,
        amount: facts.amount.toString(),
        walletAddress: facts.issuer,
        txHash: facts.txHash,
        logIndex: facts.logIndex,
        blockNumber: BigInt(facts.blockNumber),
        blockTimestamp,
      },
    });
  });

  logger.info(
    {
      operation: "confirmCampaignReclaim",
      outcome: "reclaimed",
      campaignId: campaign.id,
      onchainId: facts.onchainId.toString(),
      txHash: facts.txHash,
    },
    "Campaign recovery confirmed against chain evidence"
  );

  return {
    campaignId: campaign.id,
    status: CampaignStatus.RECLAIMED,
    reclaimedTxHash: facts.txHash,
    amount: facts.amount.toString(),
  };
}

// ---------------------------------------------------------------------------
// Claimant inbox
// ---------------------------------------------------------------------------

function mapInboxEntry(
  entitlement: Entitlement,
  campaign: Campaign,
  request: ClaimRequest | null,
  now: number
): InboxEntryResponse {
  const consumed = entitlement.consumedAt !== null;
  const expired = !consumed && campaign.expiryTime.getTime() <= now;

  let status: InboxEntryResponse["status"];
  let workflowStatus: string;
  let opensAt: string | null = null;

  if (consumed) {
    status = "Completed";
    workflowStatus = "SETTLED";
  } else if (expired) {
    status = "Expired";
    workflowStatus = "EXPIRED";
  } else if (campaign.openingTime.getTime() > now) {
    status = "Available";
    workflowStatus = "OPENS_LATER";
    opensAt = campaign.openingTime.toISOString();
  } else {
    status = "Available";
    workflowStatus = request?.status ?? "AVAILABLE";
  }

  return {
    entitlementId: entitlement.entitlementId,
    status,
    workflowStatus,
    opensAt,
    settlementTxHash: entitlement.settlementTxHash,
    approvalMode: approvalModeOf(campaign),
    campaign: campaignPublicView(campaign),
    request: request
      ? {
          requestId: request.id,
          status: request.status,
          walletAddress: request.walletAddress,
          amount: request.amount,
          deadline: request.deadline.toISOString(),
        }
      : null,
  };
}

/**
 * The authenticated claimant's own funded entitlements (§8 `GET /inbox`).
 *
 * Eligibility is the verified email the identity provider reports, reduced to the same
 * `emailHash` the roster was built with. Caller-supplied email and query parameters are
 * never consulted: the hash comes from `authUser.email`, which is provider-verified, and a
 * non-matching account simply sees an empty inbox rather than another person's campaign.
 */
export async function listInbox(authUser?: AuthenticatedUser): Promise<{
  entries: InboxEntryResponse[];
}> {
  requirePrivyId(authUser);

  const emailHash = eligibilityEmailHash(authUser?.email ?? null);
  if (!emailHash) {
    return { entries: [] };
  }

  const entitlements = await prisma.entitlement.findMany({
    where: { emailHash },
    include: { campaign: true },
  });

  const now = Date.now();
  const entries: InboxEntryResponse[] = [];

  for (const entitlement of entitlements) {
    const campaign = entitlement.campaign;
    if (campaign.status === CampaignStatus.DRAFT) {
      continue;
    }

    const request = await prisma.claimRequest.findUnique({
      where: {
        campaignId_entitlementId: {
          campaignId: campaign.id,
          entitlementId: entitlement.entitlementId,
        },
      },
    });

    entries.push(mapInboxEntry(entitlement, campaign, request, now));
  }

  return { entries };
}
