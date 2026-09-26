import type { Campaign, ClaimRequest, Entitlement } from "@prisma/client";
import { CampaignStatus, ClaimRequestStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { backendSigner } from "../config/wallets";
import { logger } from "../config/logger";
import {
  APPROVAL_TYPES,
  consentDigest,
  claimCoreDomain,
  eligibilityEmailHash,
  recoverApprovalSigner,
  recoverClaimRequestSigner,
  unixSeconds,
} from "../utils/claimCore";
import type { ApprovalPayload } from "../utils/claimCore";
import {
  ConfigurationError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../utils/errors";
import type { AuthenticatedUser } from "../middleware/auth";
import type { ClaimRequestReceiptResponse, ConsentRequest } from "../dto/campaign.dto";

/**
 * The claimant/issuer workflow around one settlement.
 *
 * Nothing here chooses a payout or moves funds: the claimant signs the request that picks
 * the destination, the issuer approver signs the same request (a signature the backend
 * verifies but never produces), and the Resolver attestation is generated later, from the
 * Resolver key Nomine holds, only for a request that already carries both. See
 * `docs/nomine-claim-core-integration.md` §3 and §8.
 */

function requirePrivyId(authUser?: AuthenticatedUser): string {
  if (!authUser?.privyUserId) {
    throw new UnauthorizedError("Authenticated user is required");
  }
  return authUser.privyUserId;
}

/**
 * The exact `Approval` both authorities sign for a stored request (§2).
 *
 * `consentDigest` is the claimant's own EIP-712 digest, so an approval is bound to the
 * signed request by content and there is no ordering claim to forge.
 */
export function buildApprovalPayload(
  campaign: Campaign,
  request: ClaimRequest
): ApprovalPayload {
  if (campaign.onchainId === null || campaign.onchainId === undefined) {
    throw new ValidationError("Campaign is not funded on-chain yet");
  }
  if (!request.consentDigest) {
    throw new ValidationError("This request has no consent digest yet");
  }
  return {
    campaignId: campaign.onchainId,
    entitlementId: request.entitlementId,
    wallet: request.walletAddress,
    amount: BigInt(request.amount),
    deadline: unixSeconds(request.deadline),
    consentDigest: request.consentDigest,
  };
}

/** The digest the claimant signed, recomputed from the stored request. */
export function recomputeConsentDigest(request: ClaimRequest, campaign: Campaign): string {
  if (campaign.onchainId === null || campaign.onchainId === undefined) {
    throw new ValidationError("Campaign is not funded on-chain yet");
  }
  return consentDigest({
    campaignId: campaign.onchainId,
    entitlementId: request.entitlementId,
    wallet: request.walletAddress,
    amount: BigInt(request.amount),
    deadline: unixSeconds(request.deadline),
  });
}

/**
 * Generates the Resolver attestation over an approval payload.
 *
 * This is the only authority signature the backend produces, and it is produced only after
 * both the claimant's consent and the issuer's approval are already stored. The issuer's key
 * is never requested, uploaded, stored or available here (§10).
 */
export async function signResolverAttestation(
  approval: ApprovalPayload
): Promise<string> {
  return backendSigner.signTypedData(claimCoreDomain(), APPROVAL_TYPES, approval);
}

export function mapRequestReceipt(
  request: ClaimRequest
): ClaimRequestReceiptResponse {
  return {
    requestId: request.id,
    campaignId: request.campaignId,
    entitlementId: request.entitlementId,
    walletAddress: request.walletAddress,
    amount: request.amount,
    deadline: unixSeconds(request.deadline),
    status: request.status,
    hasIssuerApproval: request.issuerApprovalSignature !== null,
    submitTxHash: request.submitTxHash,
    settlementTxHash: request.settlementTxHash,
  };
}

/**
 * The entitlement this account is entitled to claim, or a refusal.
 *
 * Eligibility is the verified provider email reduced to `emailHash` and matched against the
 * roster (§5). A mismatch is a flat 403 that says nothing about whether the identifier
 * exists or who it belongs to.
 */
async function requireOwnEntitlement(
  authUser: AuthenticatedUser,
  campaignId: string,
  entitlementId: string
): Promise<Entitlement> {
  const emailHash = eligibilityEmailHash(authUser.email);
  if (!emailHash) {
    throw new ForbiddenError(
      "Sign in with the verified email this entitlement was issued to."
    );
  }

  const entitlement = await prisma.entitlement.findUnique({
    where: { campaignId_entitlementId: { campaignId, entitlementId } },
  });

  if (!entitlement || entitlement.emailHash !== emailHash) {
    throw new ForbiddenError(
      "This entitlement is not yours, or it does not belong to this campaign."
    );
  }

  return entitlement;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

/**
 * Records the claimant's consent.
 *
 * The payout destination is chosen **only** here, by a signature over the exact request
 * (§3): the server recomputes the digest and recovers the signer, and no caller-supplied
 * field substitutes for that signature. A live request per entitlement is enforced by the
 * unique key; a repeat with identical evidence converges, and any conflicting live request
 * is refused rather than silently replacing the standing authorization (§9, no revocation).
 */
export async function createConsent(
  campaignId: string,
  input: ConsentRequest,
  authUser?: AuthenticatedUser
): Promise<ClaimRequestReceiptResponse> {
  requirePrivyId(authUser);

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new NotFoundError("Campaign not found");
  }
  if (campaign.status !== CampaignStatus.FUNDED) {
    throw new ValidationError("Campaign is not funded");
  }
  if (campaign.onchainId === null || campaign.onchainId === undefined) {
    throw new ValidationError("Campaign is not funded on-chain yet");
  }

  await requireOwnEntitlement(authUser as AuthenticatedUser, campaignId, input.entitlementId);

  const now = Math.floor(Date.now() / 1000);
  if (now < unixSeconds(campaign.openingTime)) {
    throw new ValidationError("This campaign is not open yet");
  }
  if (now >= unixSeconds(campaign.expiryTime)) {
    throw new ValidationError("This campaign has expired");
  }
  if (input.amount !== campaign.allocation) {
    throw new ValidationError(
      "Requested amount does not match this campaign's fixed allocation"
    );
  }
  if (input.deadline <= now) {
    throw new ValidationError("Deadline must be in the future");
  }

  const wallet = input.walletAddress.toLowerCase();
  const payload = {
    campaignId: campaign.onchainId,
    entitlementId: input.entitlementId,
    wallet,
    amount: BigInt(campaign.allocation),
    deadline: input.deadline,
  };
  const digest = consentDigest(payload);

  const recovered = recoverClaimRequestSigner(payload, input.signature);
  if (!recovered) {
    throw new ValidationError("Invalid consent signature");
  }
  if (recovered !== wallet) {
    throw new ForbiddenError("Consent signature does not match the payout wallet");
  }

  const existing = await prisma.claimRequest.findUnique({
    where: {
      campaignId_entitlementId: {
        campaignId,
        entitlementId: input.entitlementId,
      },
    },
  });
  if (existing) {
    if (
      existing.consentDigest?.toLowerCase() === digest.toLowerCase() &&
      existing.walletAddress.toLowerCase() === wallet &&
      existing.amount === campaign.allocation
    ) {
      return mapRequestReceipt(existing);
    }
    throw new ValidationError(
      "A live claim request already exists for this entitlement. The contract has no " +
        "revocation, so the standing signed request remains in force."
    );
  }

  let created: ClaimRequest;
  try {
    created = await prisma.claimRequest.create({
      data: {
        campaignId,
        entitlementId: input.entitlementId,
        walletAddress: wallet,
        amount: campaign.allocation,
        deadline: new Date(input.deadline * 1000),
        status: ClaimRequestStatus.CONSENTED,
        consentSignature: input.signature,
        consentDigest: digest,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await prisma.claimRequest.findUnique({
        where: {
          campaignId_entitlementId: {
            campaignId,
            entitlementId: input.entitlementId,
          },
        },
      });
      if (
        raced &&
        raced.consentDigest?.toLowerCase() === digest.toLowerCase() &&
        raced.walletAddress.toLowerCase() === wallet
      ) {
        return mapRequestReceipt(raced);
      }
      throw new ValidationError(
        "A live claim request already exists for this entitlement."
      );
    }
    throw error;
  }

  logger.info(
    {
      operation: "createConsent",
      outcome: "consented",
      campaignId,
      requestId: created.id,
    },
    "Claimant consent recorded"
  );

  return mapRequestReceipt(created);
}

/**
 * Verifies and stores the issuer approver's attestation.
 *
 * The signature must recover to the campaign's configured `issuerApprover`. It is never
 * produced by the backend: the issuer's key stays with the issuer (§10), and the software
 * only checks that what arrived is a valid approval over the stored request.
 */
export async function submitIssuerApproval(
  campaignId: string,
  requestId: string,
  signature: string,
  authUser?: AuthenticatedUser
): Promise<ClaimRequestReceiptResponse> {
  const issuerPrivyId = requirePrivyId(authUser);

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    throw new NotFoundError("Campaign not found");
  }
  if (campaign.issuerPrivyId !== issuerPrivyId) {
    throw new ForbiddenError("Only the issuer can approve requests for this campaign");
  }

  const request = await prisma.claimRequest.findUnique({ where: { id: requestId } });
  if (!request || request.campaignId !== campaignId) {
    throw new NotFoundError("Claim request not found");
  }

  if (request.status === ClaimRequestStatus.SETTLED) {
    return mapRequestReceipt(request);
  }
  if (campaign.onchainId === null || campaign.onchainId === undefined) {
    throw new ValidationError("Campaign is not funded on-chain yet");
  }
  if (!request.consentSignature || !request.consentDigest) {
    throw new ValidationError("The claimant has not consented to this request yet");
  }

  const approval = buildApprovalPayload(campaign, request);
  const expectedDigest = recomputeConsentDigest(request, campaign);
  if (expectedDigest.toLowerCase() !== request.consentDigest.toLowerCase()) {
    throw new ConfigurationError(
      "The stored consent digest does not match the stored request. Refusing to approve it."
    );
  }

  const recovered = recoverApprovalSigner(approval, signature);
  if (!recovered) {
    throw new ValidationError("Invalid issuer approval signature");
  }
  if (recovered !== campaign.issuerApproverAddress.toLowerCase()) {
    throw new ForbiddenError(
      "The approval signature does not recover to this campaign's issuer approver"
    );
  }

  const updated = await prisma.claimRequest.updateMany({
    where: {
      id: request.id,
      status: {
        in: [ClaimRequestStatus.CONSENTED, ClaimRequestStatus.ISSUER_APPROVED],
      },
    },
    data: {
      issuerApprovalSignature: signature,
      status: ClaimRequestStatus.ISSUER_APPROVED,
      updatedAt: new Date(),
    },
  });

  if (updated.count === 0) {
    const current = await prisma.claimRequest.findUnique({ where: { id: request.id } });
    if (
      current?.status === ClaimRequestStatus.SUBMITTED ||
      current?.status === ClaimRequestStatus.SETTLED
    ) {
      return mapRequestReceipt(current);
    }
    throw new ValidationError(
      `This request is not awaiting issuer approval (status ${current?.status ?? "unknown"}).`
    );
  }

  const stored = await prisma.claimRequest.findUnique({ where: { id: request.id } });
  if (!stored) {
    throw new NotFoundError("Claim request not found");
  }

  logger.info(
    {
      operation: "submitIssuerApproval",
      outcome: "issuer_approved",
      campaignId,
      requestId: request.id,
    },
    "Issuer approval verified and stored"
  );

  return mapRequestReceipt(stored);
}

/**
 * A single request's status and receipt, for its owner or the campaign's issuer (§8).
 *
 * Ownership is either the authenticated issuer or an account whose verified email hashes to
 * the entitlement's stored hash. Anyone else gets a 403 that reveals nothing about the
 * request.
 */
export async function getCampaignRequestDetail(
  campaignId: string,
  requestId: string,
  authUser?: AuthenticatedUser
): Promise<ClaimRequestReceiptResponse> {
  const privyId = requirePrivyId(authUser);

  const request = await prisma.claimRequest.findUnique({
    where: { id: requestId },
    include: { campaign: true },
  });
  if (!request || request.campaignId !== campaignId) {
    throw new NotFoundError("Claim request not found");
  }

  const isIssuer = request.campaign.issuerPrivyId === privyId;
  const emailHash = eligibilityEmailHash(authUser?.email ?? null);

  let isOwner = false;
  if (!isIssuer && emailHash) {
    const entitlement = await prisma.entitlement.findUnique({
      where: {
        campaignId_entitlementId: {
          campaignId,
          entitlementId: request.entitlementId,
        },
      },
      select: { emailHash: true },
    });
    isOwner = entitlement?.emailHash === emailHash;
  }

  if (!isIssuer && !isOwner) {
    throw new ForbiddenError("You do not have access to this claim request");
  }

  return mapRequestReceipt(request);
}

/** Whether the authenticated account is the issuer of a campaign, for relay checks. */
export function isCampaignIssuer(
  campaign: Pick<Campaign, "issuerPrivyId">,
  authUser?: AuthenticatedUser
): boolean {
  return Boolean(authUser?.privyUserId) && campaign.issuerPrivyId === authUser?.privyUserId;
}
