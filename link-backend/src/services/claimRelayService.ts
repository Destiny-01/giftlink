import { randomUUID } from "node:crypto";
import type { Campaign, ClaimRequest } from "@prisma/client";
import { CampaignStatus, ClaimEventType, ClaimRequestStatus } from "@prisma/client";
import { Contract } from "ethers";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { getRpcProvider } from "../config/arcClient";
import { relayerWallet } from "../config/wallets";
import { nomineClaimCoreInterface } from "../config/claimCoreAbi";
import { logger } from "../config/logger";
import { errorDiagnostics, isInsufficientFundsError } from "../utils/safeLog";
import {
  buildEntitlementProof,
  eligibilityEmailHash,
  recoverApprovalSigner,
  recoverClaimRequestSigner,
} from "../utils/claimCore";
import {
  ChainEvidenceError,
  ConfigurationError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from "../utils/errors";
import type { AuthenticatedUser } from "../middleware/auth";
import { assertConfiguredNetwork, getBlockTimestamp } from "./chainEvidence";
import {
  assertClaimCoreConfiguration,
  extractClaimSettlement,
  findSettlementForEntitlement,
} from "./claimCoreEvidence";
import {
  buildApprovalPayload,
  mapRequestReceipt,
  recomputeConsentDigest,
  signResolverAttestation,
} from "./claimRequestService";
import type { ClaimSettlementFacts } from "./claimCoreEvidence";
import type { ClaimRequestReceiptResponse } from "../dto/campaign.dto";

/**
 * Sponsored settlement (`docs/nomine-claim-core-integration.md` §8, §10).
 *
 * This is the one path that moves campaign USDC, and it is deliberately narrow: it requires
 * the claimant's stored consent **and** the issuer's stored approval, attaches the Resolver
 * attestation, and submits `settle` from the relayer wallet. Every recorded fact then comes
 * from the contract's canonical `Settlement` event, whose wallet and amount must match the
 * request exactly. A relay failure never consumes an entitlement and never masquerades as a
 * settlement: an entitlement is only marked consumed from a verified event (D-004).
 *
 * Idempotent and safe under retries/concurrency: a settled request returns its receipt, a
 * submission that reverts because an earlier attempt landed is reconciled from the chain,
 * and the contract itself refuses a second settlement of the same entitlement.
 */

function requirePrivyId(authUser?: AuthenticatedUser): string {
  if (!authUser?.privyUserId) {
    throw new UnauthorizedError("Authenticated user is required");
  }
  return authUser.privyUserId;
}

/**
 * Recovers a settlement that already happened on-chain.
 *
 * Returns the existing receipt when the contract already recorded this entitlement's
 * settlement for this wallet, and `null` when nothing is settled yet. A settlement to a
 * different wallet is a hard refusal rather than a silent converge.
 */
async function reconcileSubmission(
  campaign: Campaign,
  request: ClaimRequest
): Promise<ClaimRequestReceiptResponse | null> {
  if (campaign.onchainId === null || campaign.onchainId === undefined) {
    return null;
  }

  const facts = await findSettlementForEntitlement(
    campaign.onchainId,
    request.entitlementId
  );
  if (!facts) {
    return null;
  }

  if (facts.wallet !== request.walletAddress.toLowerCase()) {
    throw new ForbiddenError("This entitlement was settled to a different wallet");
  }

  const stored = await persistSettlement(campaign, request, facts);
  return mapRequestReceipt(stored);
}

/**
 * Writes the one canonical settlement record for a request, from verified chain facts.
 *
 * The entitlement is claimed by a conditional `updateMany` (`consumedAt: null`), so exactly
 * one writer can ever mark it consumed. A duplicate with the same transaction converges; a
 * different transaction for an already-consumed entitlement is rejected rather than merged.
 */
async function persistSettlement(
  campaign: Campaign,
  request: ClaimRequest,
  facts: ClaimSettlementFacts
): Promise<ClaimRequest> {
  const consumedAt = (await getBlockTimestamp(facts.blockNumber)) ?? new Date();

  return prisma.$transaction(async (tx) => {
    const consumed = await tx.entitlement.updateMany({
      where: {
        campaignId: campaign.id,
        entitlementId: request.entitlementId,
        consumedAt: null,
      },
      data: {
        consumedAt,
        settlementTxHash: facts.txHash,
        claimantAddress: facts.wallet,
      },
    });

    if (consumed.count === 0) {
      const current = await tx.entitlement.findUnique({
        where: {
          campaignId_entitlementId: {
            campaignId: campaign.id,
            entitlementId: request.entitlementId,
          },
        },
        select: { settlementTxHash: true },
      });
      if (current?.settlementTxHash !== facts.txHash) {
        throw new ChainEvidenceError(
          `Entitlement ${request.entitlementId} is already consumed by transaction ` +
            `${current?.settlementTxHash ?? "unknown"}. Refusing to record ${facts.txHash}.`
        );
      }
    }

    await tx.claimRequest.updateMany({
      where: { id: request.id },
      data: {
        status: ClaimRequestStatus.SETTLED,
        settlementTxHash: facts.txHash,
        updatedAt: new Date(),
      },
    });

    await tx.claimEvent.upsert({
      where: { txHash_logIndex: { txHash: facts.txHash, logIndex: facts.logIndex } },
      update: {},
      create: {
        chainId: env.CHAIN_ID,
        contractAddress: campaign.contractAddress,
        eventType: ClaimEventType.SETTLEMENT,
        campaignId: campaign.id,
        onchainCampaignId: facts.onchainId,
        entitlementId: request.entitlementId,
        walletAddress: facts.wallet,
        amount: facts.amount.toString(),
        txHash: facts.txHash,
        logIndex: facts.logIndex,
        blockNumber: BigInt(facts.blockNumber),
        blockTimestamp: consumedAt,
      },
    });

    const updated = await tx.claimRequest.findUnique({ where: { id: request.id } });
    if (!updated) {
      throw new NotFoundError("Claim request not found");
    }
    return updated;
  });
}

/**
 * Submits `settle` from the relayer and records the verified result.
 */
export async function settleClaim(
  campaignId: string,
  requestId: string,
  authUser?: AuthenticatedUser
): Promise<ClaimRequestReceiptResponse> {
  const privyId = requirePrivyId(authUser);

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new NotFoundError("Campaign not found");
  }

  const request = await prisma.claimRequest.findUnique({ where: { id: requestId } });
  if (!request || request.campaignId !== campaignId) {
    throw new NotFoundError("Claim request not found");
  }

  const entitlement = await prisma.entitlement.findUnique({
    where: {
      campaignId_entitlementId: {
        campaignId,
        entitlementId: request.entitlementId,
      },
    },
  });
  const emailHash = eligibilityEmailHash(authUser?.email ?? null);
  const isIssuer = campaign.issuerPrivyId === privyId;
  const isClaimant = emailHash !== null && entitlement?.emailHash === emailHash;
  if (!isIssuer && !isClaimant) {
    throw new ForbiddenError("You do not have access to this claim request");
  }

  if (campaign.status === CampaignStatus.RECLAIMED) {
    throw new ValidationError("This campaign has already been reclaimed");
  }
  if (campaign.onchainId === null || campaign.onchainId === undefined) {
    throw new ValidationError("Campaign is not funded on-chain yet");
  }

  // Already settled: converge on the stored receipt.
  if (request.status === ClaimRequestStatus.SETTLED && request.settlementTxHash) {
    return mapRequestReceipt(request);
  }

  // A previous attempt was broadcast: recover the settlement if it landed.
  if (request.status === ClaimRequestStatus.SUBMITTED) {
    const reconciled = await reconcileSubmission(campaign, request);
    if (reconciled) {
      return reconciled;
    }
  }

  if (!request.consentSignature || !request.consentDigest) {
    throw new ValidationError("The claimant has not consented to this request yet");
  }
  if (!request.issuerApprovalSignature) {
    throw new ValidationError("This request has not been approved by the issuer yet");
  }

  const now = Math.floor(Date.now() / 1000);
  if (now < Math.floor(campaign.openingTime.getTime() / 1000)) {
    throw new ValidationError("This campaign is not open yet");
  }
  if (now >= Math.floor(campaign.expiryTime.getTime() / 1000)) {
    throw new ValidationError("This campaign has expired");
  }
  if (now > Math.floor(request.deadline.getTime() / 1000)) {
    throw new ValidationError("The claim request deadline has passed");
  }

  const provider = getRpcProvider();
  await assertConfiguredNetwork(provider);
  await assertClaimCoreConfiguration(provider);

  // Relayer gas is checked before anything is signed or written, so a relay outage leaves no
  // half-finished state (§8: "Relay/RPC failure must never consume an entitlement").
  const relayerBalance = await provider.getBalance(relayerWallet.address);
  if (relayerBalance === 0n) {
    throw new ServiceUnavailableError("Relayer has insufficient balance for gas");
  }

  const approval = buildApprovalPayload(campaign, request);

  const expectedDigest = recomputeConsentDigest(request, campaign);
  if (expectedDigest.toLowerCase() !== request.consentDigest.toLowerCase()) {
    throw new ConfigurationError(
      "The stored consent digest does not match the stored request. Refusing to submit it."
    );
  }

  const recoveredClaimant = recoverClaimRequestSigner(
    {
      campaignId: approval.campaignId,
      entitlementId: approval.entitlementId,
      wallet: approval.wallet,
      amount: approval.amount,
      deadline: approval.deadline,
    },
    request.consentSignature
  );
  if (recoveredClaimant !== request.walletAddress.toLowerCase()) {
    throw new ConfigurationError(
      "The stored consent signature does not recover to the payout wallet. Refusing to submit."
    );
  }

  const recoveredIssuer = recoverApprovalSigner(approval, request.issuerApprovalSignature);
  if (recoveredIssuer !== campaign.issuerApproverAddress.toLowerCase()) {
    throw new ConfigurationError(
      "The stored issuer approval does not recover to the configured approver. Refusing to submit."
    );
  }

  const resolverSignature = await signResolverAttestation(approval);

  const entitlements = await prisma.entitlement.findMany({
    where: { campaignId },
    select: { entitlementId: true },
  });
  const proof = buildEntitlementProof(
    entitlements.map((entry) => entry.entitlementId),
    request.entitlementId
  );

  // Submission lease. A `SUBMITTED` row is a *held* slot, not a free one, and only the attempt
  // that took it may complete or fail it. A slot is reclaimed only when it is demonstrably
  // abandoned: the lease has aged past the TTL *and* no settlement exists on-chain. Reclaiming on
  // "has not settled yet" alone let a second concurrent caller broadcast while the first was
  // still in flight, which duplicates gas and races the workflow state.
  const RELAY_LEASE_MS = 120_000;
  const attemptId = randomUUID();
  const leaseCutoff = new Date(Date.now() - RELAY_LEASE_MS);

  const takeSlot = () =>
    prisma.claimRequest.updateMany({
      where: {
        id: request.id,
        // Bind the slot to the exact consent that was verified above. A renewal replaces the digest,
        // so an attempt that validated the previous consent cannot then broadcast it against the
        // renewed row.
        consentDigest: request.consentDigest,
        status: {
          in: [
            ClaimRequestStatus.CONSENTED,
            ClaimRequestStatus.ISSUER_APPROVED,
            ClaimRequestStatus.FAILED,
          ],
        },
      },
      data: {
        status: ClaimRequestStatus.SUBMITTED,
        resolverSignature,
        submitAttemptId: attemptId,
        updatedAt: new Date(),
      },
    });

  let claim = await takeSlot();
  if (claim.count === 0) {
    const current = await prisma.claimRequest.findUnique({ where: { id: request.id } });

    if (current?.status === ClaimRequestStatus.SETTLED && current.settlementTxHash) {
      return mapRequestReceipt(current);
    }

    if (current?.status === ClaimRequestStatus.SUBMITTED) {
      // An in-flight attempt may have settled even though we never saw the receipt.
      const reconciled = await reconcileSubmission(campaign, current);
      if (reconciled) {
        return reconciled;
      }

      // Still inside its lease: the other caller owns this attempt and we must not preempt it.
      if (current.updatedAt > leaseCutoff) {
        throw new ServiceUnavailableError(
          "A settlement attempt for this request is already in progress."
        );
      }

      // Abandoned. Demote conditionally on the exact row we read, so a newer attempt that landed
      // in the meantime is never clobbered.
      const demoted = await prisma.claimRequest.updateMany({
        where: {
          id: request.id,
          status: ClaimRequestStatus.SUBMITTED,
          settlementTxHash: null,
          updatedAt: current.updatedAt,
        },
        data: {
          status: ClaimRequestStatus.FAILED,
          failureReason: "relay_lease_expired",
          submitAttemptId: null,
          updatedAt: new Date(),
        },
      });

      if (demoted.count === 1) {
        claim = await takeSlot();
      }
    }

    if (claim.count === 0) {
      throw new ServiceUnavailableError(
        "A settlement attempt for this request is already in progress."
      );
    }
  }

  const contract = new Contract(
    env.CLAIM_CORE_CONTRACT_ADDRESS,
    nomineClaimCoreInterface,
    relayerWallet.connect(provider)
  );

  let receipt;
  try {
    const tx = await contract.settle(
      {
        campaignId: approval.campaignId,
        entitlementId: approval.entitlementId,
        wallet: approval.wallet,
        amount: approval.amount,
        deadline: approval.deadline,
      },
      request.consentSignature,
      approval,
      request.issuerApprovalSignature,
      resolverSignature,
      proof
    );

    logger.info(
      {
        operation: "settleClaim",
        outcome: "submitted",
        campaignId,
        requestId: request.id,
        txHash: tx.hash,
      },
      "Settlement transaction submitted"
    );

    await prisma.claimRequest.updateMany({
      // Scoped to this attempt: a superseded attempt must not overwrite a newer one's evidence.
      where: { id: request.id, submitAttemptId: attemptId },
      data: { submitTxHash: tx.hash, updatedAt: new Date() },
    });

    receipt = await tx.wait();
  } catch (error) {
    if (isInsufficientFundsError(error)) {
      await prisma.claimRequest.updateMany({
        where: { id: request.id, submitAttemptId: attemptId },
        data: {
          status: ClaimRequestStatus.ISSUER_APPROVED,
          failureReason: "relayer_insufficient_funds",
          submitAttemptId: null,
          updatedAt: new Date(),
        },
      });
      throw new ServiceUnavailableError("Relayer has insufficient balance for gas");
    }

    // A reverted submission can still mean an earlier attempt already settled this
    // entitlement. Recover that settlement instead of reporting a failure.
    const reconciled = await reconcileSubmission(campaign, request);
    if (reconciled) {
      return reconciled;
    }

    await prisma.claimRequest.updateMany({
      // Scoped to this attempt, like every other write on the row: a superseded attempt whose
      // broadcast only fails later must not flip a newer attempt's live `SUBMITTED` row to FAILED,
      // which would let a third caller take the slot and broadcast alongside it.
      where: { id: request.id, submitAttemptId: attemptId },
      data: {
        status: ClaimRequestStatus.FAILED,
        failureReason: "settle_reverted",
        submitAttemptId: null,
        updatedAt: new Date(),
      },
    });

    // Only controlled diagnostics: a provider message can carry calldata or arguments.
    logger.error({
      operation: "settleClaim",
      outcome: "transaction_failed",
      campaignId,
      requestId: request.id,
      ...errorDiagnostics(error),
    });

    throw new ValidationError(
      "The settlement transaction failed on-chain. Please retry, and report the campaign link if it persists."
    );
  }

  if (!receipt) {
    throw new ServiceUnavailableError("Settlement was not confirmed");
  }

  const facts = extractClaimSettlement(receipt, {
    contractAddress: env.CLAIM_CORE_CONTRACT_ADDRESS,
    onchainId: BigInt(approval.campaignId),
    entitlementId: request.entitlementId,
  });

  if (facts.wallet !== request.walletAddress.toLowerCase()) {
    throw new ChainEvidenceError(
      `Transaction ${facts.txHash} settled to ${facts.wallet}, not ${request.walletAddress}. ` +
        "Refusing to record it against this claim."
    );
  }
  if (facts.amount !== BigInt(campaign.allocation)) {
    throw new ChainEvidenceError(
      `Transaction ${facts.txHash} reports an amount that does not match the campaign ` +
        `allocation ${campaign.allocation}. Refusing to record a settlement that does not match.`
    );
  }

  const stored = await persistSettlement(campaign, request, facts);

  logger.info(
    {
      operation: "settleClaim",
      outcome: "settled",
      campaignId,
      requestId: request.id,
      txHash: facts.txHash,
    },
    "Settlement recorded from chain evidence"
  );

  return mapRequestReceipt(stored);
}
