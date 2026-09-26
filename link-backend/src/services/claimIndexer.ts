import type { JsonRpcProvider } from "ethers";
import { Contract } from "ethers";
import { CampaignStatus, ClaimEventType, ClaimRequestStatus } from "@prisma/client";
import type { ClaimEvent } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { getRpcProvider } from "../config/arcClient";
import { nomineClaimCoreInterface } from "../config/claimCoreAbi";
import { logger } from "../config/logger";
import { errorDiagnostics } from "../utils/safeLog";
import { getBlockTimestamp } from "./chainEvidence";
import { entitlementRoot as computeEntitlementRoot } from "../utils/claimCore";

/**
 * Canonical-event indexer for Nomine Claim Core (`docs/nomine-claim-core-integration.md` §6).
 *
 * Scanning is durable and deduped: a `ChainCheckpoint` row per (chainId, contractAddress)
 * records the last block scanned, and every log is keyed by `(txHash, logIndex)` in
 * `ClaimEvent`, so re-running a scan over an overlapping range stores nothing twice.
 *
 * Replay rebuilds local state from the stored events and lets **on-chain state win** (D-004):
 * a `CampaignFunded` event funds a draft campaign, a `Settlement` event consumes its
 * entitlement and settles its request, and a `CampaignReclaimed` event marks the campaign
 * reclaimed. Replaying twice is a no-op, because every write is guarded on the field it
 * would otherwise overwrite.
 */

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

export interface ClaimIndexerScanResult {
  fromBlock: number;
  toBlock: number;
  stored: number;
}

export interface ClaimIndexerReplayResult {
  funded: number;
  settled: number;
  reclaimed: number;
}

/**
 * Stores one decoded log as a `ClaimEvent`, returning 1 when it was new and 0 when the
 * `(txHash, logIndex)` key was already present. `campaignId` is bound only when the campaign
 * this event names is already known locally; otherwise it stays null and replay fills it in
 * once the campaign is bound.
 */
async function storeClaimEvent(
  log: { topics: ReadonlyArray<string>; data: string; index: number; transactionHash: string; blockNumber: number },
  contractAddress: string
): Promise<number> {
  let parsed;
  try {
    parsed = nomineClaimCoreInterface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
  } catch {
    return 0;
  }
  if (!parsed) {
    return 0;
  }

  const txHash = log.transactionHash;
  const logIndex = log.index;

  const existing = await prisma.claimEvent.findUnique({
    where: { txHash_logIndex: { txHash, logIndex } },
    select: { id: true },
  });
  if (existing) {
    return 0;
  }

  const onchainCampaignId = BigInt(parsed.args.campaignId as bigint);
  const campaign = await prisma.campaign.findFirst({
    where: {
      chainId: env.CHAIN_ID,
      contractAddress,
      onchainId: onchainCampaignId,
    },
    select: { id: true },
  });

  const blockTimestamp = await getBlockTimestamp(log.blockNumber);

  let eventType: ClaimEventType;
  let entitlementId: string | null = null;
  let walletAddress: string | null = null;
  let amount: string | null = null;
  const metadata: Record<string, unknown> = {};

  switch (parsed.name) {
    case "CampaignFunded":
      eventType = ClaimEventType.CAMPAIGN_FUNDED;
      walletAddress = String(parsed.args.issuer).toLowerCase();
      amount = BigInt(parsed.args.fundedAmount as bigint).toString();
      metadata.issuerApprover = String(parsed.args.issuerApprover).toLowerCase();
      metadata.resolver = String(parsed.args.resolver).toLowerCase();
      metadata.allocation = BigInt(parsed.args.allocation as bigint).toString();
      metadata.entitlementCount = Number(parsed.args.entitlementCount);
      metadata.entitlementRoot = String(parsed.args.entitlementRoot);
      break;
    case "Settlement":
      eventType = ClaimEventType.SETTLEMENT;
      entitlementId = String(parsed.args.entitlementId);
      walletAddress = String(parsed.args.wallet).toLowerCase();
      amount = BigInt(parsed.args.amount as bigint).toString();
      metadata.submitter = String(parsed.args.submitter).toLowerCase();
      break;
    case "CampaignReclaimed":
      eventType = ClaimEventType.CAMPAIGN_RECLAIMED;
      walletAddress = String(parsed.args.issuer).toLowerCase();
      amount = BigInt(parsed.args.amount as bigint).toString();
      break;
    default:
      return 0;
  }

  try {
    await prisma.claimEvent.create({
      data: {
        chainId: env.CHAIN_ID,
        contractAddress,
        eventType,
        campaignId: campaign?.id ?? null,
        onchainCampaignId,
        entitlementId,
        walletAddress,
        amount,
        txHash,
        logIndex,
        blockNumber: BigInt(log.blockNumber),
        blockTimestamp,
        metadata: metadata as unknown as Prisma.InputJsonValue,
      },
    });
    return 1;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return 0;
    }
    throw error;
  }
}

/**
 * Scans the configured contract's canonical events into `ClaimEvent`, resuming from the
 * durable checkpoint and advancing it to the last scanned block.
 */
export async function scanClaimEvents(
  options: { provider?: JsonRpcProvider; fromBlock?: number; toBlock?: number } = {}
): Promise<ClaimIndexerScanResult> {
  const provider = options.provider ?? getRpcProvider();
  const contractAddress = env.CLAIM_CORE_CONTRACT_ADDRESS.toLowerCase();

  const checkpoint = await prisma.chainCheckpoint.findUnique({
    where: {
      chainId_contractAddress: {
        chainId: env.CHAIN_ID,
        contractAddress,
      },
    },
  });

  const fromBlock =
    options.fromBlock ??
    (checkpoint ? Number(checkpoint.lastScannedBlock) + 1 : 0);
  const toBlock = options.toBlock ?? (await provider.getBlockNumber());

  if (fromBlock > toBlock) {
    return { fromBlock, toBlock, stored: 0 };
  }

  const contract = new Contract(
    contractAddress,
    nomineClaimCoreInterface,
    provider
  );

  const [funded, settlements, reclaimed] = await Promise.all([
    contract.queryFilter(contract.filters.CampaignFunded(), fromBlock, toBlock),
    contract.queryFilter(contract.filters.Settlement(), fromBlock, toBlock),
    contract.queryFilter(
      contract.filters.CampaignReclaimed(),
      fromBlock,
      toBlock
    ),
  ]);

  let stored = 0;
  for (const log of [...funded, ...settlements, ...reclaimed]) {
    stored += await storeClaimEvent(
      {
        topics: [...log.topics],
        data: log.data,
        index: log.index,
        transactionHash: log.transactionHash,
        blockNumber: log.blockNumber,
      },
      contractAddress
    );
  }

  await prisma.chainCheckpoint.upsert({
    where: {
      chainId_contractAddress: {
        chainId: env.CHAIN_ID,
        contractAddress,
      },
    },
    update: { lastScannedBlock: BigInt(toBlock) },
    create: {
      chainId: env.CHAIN_ID,
      contractAddress,
      lastScannedBlock: BigInt(toBlock),
    },
  });

  logger.info(
    {
      operation: "scanClaimEvents",
      outcome: "scanned",
      fromBlock,
      toBlock,
      stored,
    },
    "Claim Core events scanned"
  );

  return { fromBlock, toBlock, stored };
}

async function findCampaignForEvent(event: ClaimEvent) {
  return prisma.campaign.findFirst({
    where: {
      chainId: event.chainId,
      contractAddress: event.contractAddress,
      onchainId: event.onchainCampaignId,
    },
    select: { id: true },
  });
}

/**
 * Bind a funding event to a draft whose confirmation never arrived.
 *
 * The normal path requires an already-recorded `onchainId`, so a lost confirmation (the browser was
 * closed, the request failed, the indexer ran first) left the campaign funded on-chain but unbound
 * locally, and its entitlements could never settle. Matching is on the *immutable committed
 * configuration* the event carries, and is accepted only when exactly one draft matches, so a
 * coincidental partial match cannot attach funds to a different roster.
 */
async function bindUnboundDraft(event: ClaimEvent) {
  const metadata = (event.metadata ?? {}) as Record<string, unknown>;
  const issuer = String(event.walletAddress ?? "").toLowerCase();
  const issuerApprover =
    typeof metadata.issuerApprover === "string" ? metadata.issuerApprover.toLowerCase() : null;
  const resolver =
    typeof metadata.resolver === "string" ? metadata.resolver.toLowerCase() : null;
  const allocation = typeof metadata.allocation === "string" ? metadata.allocation : null;
  const entitlementCount =
    typeof metadata.entitlementCount === "number" ? metadata.entitlementCount : null;
  const committedRoot =
    typeof metadata.entitlementRoot === "string" ? metadata.entitlementRoot.toLowerCase() : null;

  if (
    !issuer ||
    !issuerApprover ||
    !resolver ||
    !allocation ||
    entitlementCount === null ||
    !committedRoot
  ) {
    return null;
  }

  const candidates = await prisma.campaign.findMany({
    where: {
      chainId: event.chainId,
      contractAddress: event.contractAddress,
      onchainId: null,
      status: CampaignStatus.DRAFT,
      issuerAddress: issuer,
      issuerApproverAddress: issuerApprover,
      resolverAddress: resolver,
      allocation,
      entitlementCount,
    },
    select: { id: true, entitlements: { select: { entitlementId: true } } },
    take: 2,
  });

  if (candidates.length !== 1) {
    return null;
  }

  // The commitment binds the funded roster to the prepared roster: the five scalar matches alone
  // could still describe different entitlement identifiers.
  const candidate = candidates[0];
  const identifiers = candidate.entitlements.map((item) => item.entitlementId);
  if (identifiers.length !== entitlementCount) {
    return null;
  }
  if (computeEntitlementRoot(identifiers).toLowerCase() !== committedRoot) {
    return null;
  }

  return { id: candidate.id };
}

async function replayFunding(event: ClaimEvent): Promise<number> {
  const campaign =
    (await findCampaignForEvent(event)) ?? (await bindUnboundDraft(event));
  if (!campaign) {
    return 0;
  }

  const updated = await prisma.campaign.updateMany({
    where: { id: campaign.id, status: CampaignStatus.DRAFT },
    data: {
      status: CampaignStatus.FUNDED,
      onchainId: event.onchainCampaignId,
      fundingTxHash: event.txHash,
      updatedAt: new Date(),
    },
  });
  return updated.count;
}

async function replaySettlement(event: ClaimEvent): Promise<number> {
  if (!event.entitlementId || !event.walletAddress || !event.amount) {
    return 0;
  }
  const campaign = await findCampaignForEvent(event);
  if (!campaign) {
    return 0;
  }

  const consumedAt = event.blockTimestamp ?? new Date();

  const consumed = await prisma.entitlement.updateMany({
    where: {
      campaignId: campaign.id,
      entitlementId: event.entitlementId,
      consumedAt: null,
    },
    data: {
      consumedAt,
      settlementTxHash: event.txHash,
      claimantAddress: event.walletAddress,
      updatedAt: new Date(),
    },
  });

  // The chain is authoritative for settlement, so the workflow request converges even if it
  // never observed the relay's own response.
  await prisma.claimRequest.updateMany({
    where: {
      campaignId: campaign.id,
      entitlementId: event.entitlementId,
      status: { not: ClaimRequestStatus.SETTLED },
    },
    data: {
      status: ClaimRequestStatus.SETTLED,
      settlementTxHash: event.txHash,
      updatedAt: new Date(),
    },
  });

  return consumed.count;
}

async function replayReclaim(event: ClaimEvent): Promise<number> {
  const campaign = await findCampaignForEvent(event);
  if (!campaign) {
    return 0;
  }

  const updated = await prisma.campaign.updateMany({
    where: { id: campaign.id, status: { not: CampaignStatus.RECLAIMED } },
    data: {
      status: CampaignStatus.RECLAIMED,
      reclaimedTxHash: event.txHash,
      updatedAt: new Date(),
    },
  });
  return updated.count;
}

/**
 * Rebuilds local campaign totals and entitlement consumption from the stored canonical
 * events. Every write is guarded on the field it would overwrite, so replaying an already
 * applied event changes nothing.
 */
export async function replayClaimEvents(): Promise<ClaimIndexerReplayResult> {
  const contractAddress = env.CLAIM_CORE_CONTRACT_ADDRESS.toLowerCase();

  const events = await prisma.claimEvent.findMany({
    where: { chainId: env.CHAIN_ID, contractAddress },
    orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
  });

  let funded = 0;
  let settled = 0;
  let reclaimed = 0;

  for (const event of events) {
    switch (event.eventType) {
      case ClaimEventType.CAMPAIGN_FUNDED:
        funded += await replayFunding(event);
        break;
      case ClaimEventType.SETTLEMENT:
        settled += await replaySettlement(event);
        break;
      case ClaimEventType.CAMPAIGN_RECLAIMED:
        reclaimed += await replayReclaim(event);
        break;
      default:
        break;
    }
  }

  return { funded, settled, reclaimed };
}

/**
 * One indexer pass: scan new canonical events, then replay them into local state.
 */
export async function runClaimIndexerOnce(
  options: { provider?: JsonRpcProvider; fromBlock?: number; toBlock?: number } = {}
): Promise<{ scan: ClaimIndexerScanResult; replay: ClaimIndexerReplayResult }> {
  try {
    const scan = await scanClaimEvents(options);
    const replay = await replayClaimEvents();
    return { scan, replay };
  } catch (error) {
    logger.error({
      operation: "runClaimIndexerOnce",
      outcome: "failure",
      ...errorDiagnostics(error),
    });
    throw error;
  }
}
