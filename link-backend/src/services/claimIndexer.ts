import type { JsonRpcProvider } from "ethers";
import { CampaignStatus, ClaimEventType, ClaimRequestStatus } from "@prisma/client";
import type { ClaimEvent } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { getRpcProvider } from "../config/arcClient";
import { CLAIM_CORE_EVENTS, nomineClaimCoreInterface } from "../config/claimCoreAbi";
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

/** The smallest window the adaptive scan will try; a rejection below this aborts the pass. */
const MIN_WINDOW_SIZE = 100;
/** A pass stops starting new windows after this long and resumes from the checkpoint next pass. */
const PASS_TIME_BUDGET_MS = 4 * 60 * 1000;

/**
 * The only event names `storeClaimEvent` knows how to persist. A window query returns *every*
 * log the contract emitted, so anything else (for example `EIP712DomainChanged`) must be
 * discarded before its decoded args are read - the canonical events carry `campaignId`, the
 * others do not.
 */
const CANONICAL_EVENT_NAMES = new Set<string>(Object.values(CLAIM_CORE_EVENTS));

/**
 * Whether an RPC failure looks like the node refusing a block range rather than a transient
 * or authorization problem.
 *
 * Only a range/size rejection is worth retrying with a smaller window. Shrinking on anything
 * else would silently mask a real failure (bad auth, a dead endpoint) behind a storm of extra
 * requests, so the two are deliberately kept apart.
 */
function isRangeOrSizeError(error: unknown): boolean {
  const candidate = error as
    | {
        code?: unknown;
        message?: unknown;
        shortMessage?: unknown;
        error?: { code?: unknown; message?: unknown };
        info?: { error?: { code?: unknown; message?: unknown } };
      }
    | null;

  // ethers wraps a JSON-RPC failure: `candidate.code` is ethers' own string code and the raw
  // server code/message are attached nested (under `error` on the default path, `info.error`
  // on others). A range rejection is recognized by that raw code, or by its message text.
  const nested = [candidate?.error, candidate?.info?.error];
  const codes = [candidate?.code, ...nested.map((entry) => entry?.code)];

  for (const code of codes) {
    if (
      code === -32005 ||
      code === -32602 ||
      code === "-32005" ||
      code === "-32602"
    ) {
      return true;
    }
  }

  const text = [
    typeof candidate?.message === "string" ? candidate.message : "",
    typeof candidate?.shortMessage === "string" ? candidate.shortMessage : "",
    typeof candidate?.code === "string" ? candidate.code : "",
    ...nested.map((entry) =>
      typeof entry?.message === "string" ? entry.message : ""
    ),
  ]
    .join(" ")
    .toLowerCase();

  return ["range", "limit", "too many", "exceed"].some((token) =>
    text.includes(token)
  );
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
  contractAddress: string,
  provider: JsonRpcProvider
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
  if (!parsed || !CANONICAL_EVENT_NAMES.has(parsed.name)) {
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

  const blockTimestamp = await getBlockTimestamp(log.blockNumber, provider);

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
 * Scans the configured contract's canonical events into `ClaimEvent`.
 *
 * The scan is windowed and adaptive. It starts at the larger of the durable checkpoint and
 * the configured deploy block (never block `0`, which a public RPC rejects), walks the range
 * in consecutive windows of at most `INDEXER_MAX_BLOCK_RANGE`, and checkpoints the end of each
 * window as soon as it is stored - so a crash mid-catch-up resumes from the last completed
 * window instead of re-reading the whole range. A window the node rejects as too large is
 * halved and retried; any other failure aborts the pass rather than silently shrinking it.
 *
 * A pass also stops starting new windows after a fixed time budget and leaves the rest to the
 * next pass, so a multi-million-block catch-up cannot hold the process open indefinitely.
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
    Math.max(
      checkpoint ? Number(checkpoint.lastScannedBlock) + 1 : 0,
      env.CLAIM_CORE_DEPLOY_BLOCK
    );
  const toBlock = options.toBlock ?? (await provider.getBlockNumber());

  if (fromBlock > toBlock) {
    return { fromBlock, toBlock, stored: 0 };
  }

  const startedAt = Date.now();
  let windowSize = env.INDEXER_MAX_BLOCK_RANGE;
  let cursor = fromBlock;
  let stored = 0;
  let scannedTo = fromBlock - 1;

  while (cursor <= toBlock) {
    if (Date.now() - startedAt >= PASS_TIME_BUDGET_MS) {
      logger.info(
        {
          operation: "scanClaimEvents",
          outcome: "time_budget_reached",
          cursor,
          toBlock,
        },
        "Claim Core scan stopped at the pass time budget; the next pass resumes from the checkpoint"
      );
      break;
    }

    const windowTo = Math.min(cursor + windowSize - 1, toBlock);

    let logs;
    try {
      logs = await provider.getLogs({
        address: contractAddress,
        fromBlock: cursor,
        toBlock: windowTo,
      });
    } catch (error) {
      // The node refused this window as too large: shrink and retry the *same* window, so the
      // range stays contiguous and nothing is skipped.
      if (isRangeOrSizeError(error) && windowSize > MIN_WINDOW_SIZE) {
        windowSize = Math.max(MIN_WINDOW_SIZE, Math.floor(windowSize / 2));
        continue;
      }
      throw error;
    }

    for (const log of logs) {
      stored += await storeClaimEvent(log, contractAddress, provider);
    }

    // Advance the durable checkpoint before moving on: the completed window is now the
    // resume point, so a crash never re-reads it and never skips past it.
    await prisma.chainCheckpoint.upsert({
      where: {
        chainId_contractAddress: {
          chainId: env.CHAIN_ID,
          contractAddress,
        },
      },
      update: { lastScannedBlock: BigInt(windowTo) },
      create: {
        chainId: env.CHAIN_ID,
        contractAddress,
        lastScannedBlock: BigInt(windowTo),
      },
    });

    scannedTo = windowTo;
    cursor = windowTo + 1;
  }

  logger.info(
    {
      operation: "scanClaimEvents",
      outcome: "scanned",
      fromBlock,
      toBlock: scannedTo,
      stored,
    },
    "Claim Core events scanned"
  );

  return { fromBlock, toBlock: scannedTo, stored };
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
 * locally, and its entitlements could never settle.
 *
 * The event carries the committed configuration *and* the entitlement commitment, so matching is a
 * two-step: the scalar filter narrows to the drafts that share the immutable scalar config, then the
 * recomputed entitlement root picks the single draft whose roster the event actually committed. Only
 * a unique root match binds, so a coincidental scalar match cannot attach funds to a different roster.
 * The scalar filter can legitimately describe more than one draft (two drafts may share the same
 * approver, resolver, allocation and count), and only the root tells them apart.
 *
 * The funder is deliberately **not** part of the query: `confirmCampaignFunding` accepts funding from
 * any wallet linked to the issuer's account, while the draft stores the wallet that was linked at
 * prepare time, so filtering on it would silently skip exactly the lost-confirmation cases this
 * exists for. Legitimacy is checked after the match instead, using the same rule confirm uses - the
 * funder is the prepare-time wallet or the owner's recorded wallet - and a mismatch is logged rather
 * than bound.
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
      issuerApproverAddress: issuerApprover,
      resolverAddress: resolver,
      allocation,
      entitlementCount,
    },
    select: {
      id: true,
      issuerAddress: true,
      issuerPrivyId: true,
      entitlements: { select: { entitlementId: true } },
    },
    take: 100,
  });

  // The committed root is over 32-random-byte identifiers, so it names exactly one roster. Filter
  // the scalar matches down to those that reproduce it, and bind only when that leaves one.
  const rootMatches = candidates.filter(
    (candidate) =>
      computeEntitlementRoot(
        candidate.entitlements.map((item) => item.entitlementId)
      ).toLowerCase() === committedRoot
  );

  if (rootMatches.length !== 1) {
    return null;
  }

  const candidate = rootMatches[0];

  const owner = await prisma.user.findUnique({
    where: { privyId: candidate.issuerPrivyId },
    select: { walletAddress: true },
  });
  const funderIsOwner =
    issuer === candidate.issuerAddress.toLowerCase() ||
    (owner?.walletAddress !== null &&
      owner?.walletAddress !== undefined &&
      issuer === owner.walletAddress.toLowerCase());

  if (!funderIsOwner) {
    logger.warn({
      operation: "bindUnboundDraft",
      outcome: "funder_mismatch",
      campaignId: candidate.id,
      onchainCampaignId: event.onchainCampaignId.toString(),
      funder: issuer,
    });
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
  // never observed the relay's own response. The wallet must match: since a request can now be
  // renewed with a new payout wallet, a settlement that paid the previous wallet must not be
  // presented as a completed claim for the current one.
  await prisma.claimRequest.updateMany({
    where: {
      campaignId: campaign.id,
      entitlementId: event.entitlementId,
      walletAddress: event.walletAddress,
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
