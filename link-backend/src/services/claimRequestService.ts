import type { Campaign, ClaimRequest, Entitlement } from "@prisma/client";
import { CampaignStatus, ClaimRequestStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { autoApproverSigner, backendSigner } from "../config/wallets";
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
import type {
  CampaignApprovalMode,
  ClaimRequestReceiptResponse,
  ConsentReceiptResponse,
  ConsentRequest,
} from "../dto/campaign.dto";

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

/**
 * The campaign's approval mode, derived rather than stored (§D-021). A campaign is `auto`
 * exactly when its configured approver is the Nomine auto-approver; every other approver is
 * a distinct issuer-held key, i.e. `manual`.
 */
export function approvalModeOf(
  campaign: Pick<Campaign, "issuerApproverAddress">
): CampaignApprovalMode {
  const configured = env.AUTO_APPROVER_ADDRESS?.toLowerCase();
  return configured &&
    campaign.issuerApproverAddress.toLowerCase() === configured
    ? "auto"
    : "manual";
}

/** Whether the campaign's approver is the Nomine auto-approver. */
export function isAutoApprovalCampaign(
  campaign: Pick<Campaign, "issuerApproverAddress">
): boolean {
  return approvalModeOf(campaign) === "auto";
}

/**
 * Generates the auto-approver attestation over an approval payload.
 *
 * This is the second authority signature the backend can produce, and only for a campaign
 * whose configured approver is the Nomine auto-approver. It is used by the `auto` consent
 * path; the resolver attestation is still attached separately at settlement time.
 */
export async function signAutoApproverAttestation(
  approval: ApprovalPayload
): Promise<string> {
  if (!autoApproverSigner) {
    throw new ConfigurationError(
      "No auto-approver is configured; this campaign cannot be approved automatically."
    );
  }
  return autoApproverSigner.signTypedData(claimCoreDomain(), APPROVAL_TYPES, approval);
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
): Promise<ConsentReceiptResponse> {
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

  const approvalMode = approvalModeOf(campaign);

  /**
   * Turns a stored consent into the response, auto-approving first when the campaign runs in
   * `auto` mode. Autonomy is scoped exactly like the manual path: the approval is only stored
   * for a request that is still `CONSENTED`, and an already-approved, submitted or settled
   * request is returned unchanged, so a re-consent is idempotent rather than a second write.
   */
  const finalize = async (
    record: ClaimRequest
  ): Promise<ConsentReceiptResponse> => {
    if (approvalMode === "manual") {
      return { ...mapRequestReceipt(record), approvalMode };
    }
    if (
      record.status === ClaimRequestStatus.ISSUER_APPROVED ||
      record.status === ClaimRequestStatus.SUBMITTED ||
      record.status === ClaimRequestStatus.SETTLED
    ) {
      return { ...mapRequestReceipt(record), approvalMode };
    }

    const approval = buildApprovalPayload(campaign, record);
    const signature = await signAutoApproverAttestation(approval);
    const recovered = recoverApprovalSigner(approval, signature);
    if (recovered !== campaign.issuerApproverAddress.toLowerCase()) {
      throw new ConfigurationError(
        "The auto-approver signature does not recover to this campaign's approver. " +
          "Refusing to store it."
      );
    }

    const advanced = await storeVerifiedApproval(record.id, signature);

    const stored = await prisma.claimRequest.findUnique({ where: { id: record.id } });
    if (!stored) {
      throw new NotFoundError("Claim request not found");
    }

    if (advanced > 0) {
      logger.info(
        {
          operation: "createConsent",
          outcome: "auto_approved",
          campaignId,
          requestId: record.id,
        },
        "Auto-approver attested the request"
      );
    }

    return { ...mapRequestReceipt(stored), approvalMode };
  };

  await requireOwnEntitlement(authUser as AuthenticatedUser, campaignId, input.entitlementId);

  // Reconcile on-chain consumption before anything else: a settled entitlement can never take a
  // new consent, and the indexer's record of consumption wins over any local request row.
  const entitlement = await prisma.entitlement.findUnique({
    where: {
      campaignId_entitlementId: { campaignId, entitlementId: input.entitlementId },
    },
  });
  if (entitlement?.consumedAt) {
    throw new ValidationError("This entitlement has already been settled");
  }

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
      return finalize(existing);
    }

    // A standing request may be replaced only when it can no longer settle. The contract refuses
    // a settlement when `now > deadline`, so at exactly `deadline` the old signature is still
    // live and must not be discarded (there is no revocation). A request that is in flight or
    // already settled is likewise never replaced.
    const canRenew =
      existing.status !== ClaimRequestStatus.SETTLED &&
      existing.status !== ClaimRequestStatus.SUBMITTED &&
      now > unixSeconds(existing.deadline);

    if (!canRenew) {
      throw new ValidationError(
        "A live claim request already exists for this entitlement. The contract has no " +
          "revocation, so the standing signed request remains in force."
      );
    }

    // Renew atomically and only against the exact row that was read, so a concurrent consent
    // cannot be clobbered. The previous authority signatures and submission evidence belong to
    // the replaced request and are cleared with it.
    const renewed = await prisma.claimRequest.updateMany({
      where: {
        id: existing.id,
        status: existing.status,
        deadline: existing.deadline,
        consentDigest: existing.consentDigest,
      },
      data: {
        walletAddress: wallet,
        amount: campaign.allocation,
        deadline: new Date(input.deadline * 1000),
        status: ClaimRequestStatus.CONSENTED,
        consentSignature: input.signature,
        consentDigest: digest,
        issuerApprovalSignature: null,
        resolverSignature: null,
        submitTxHash: null,
        failureReason: null,
        updatedAt: new Date(),
      },
    });

    const afterRenewal = await prisma.claimRequest.findUnique({
      where: { id: existing.id },
    });

    if (renewed.count === 1) {
      logger.info(
        {
          operation: "createConsent",
          outcome: "renewed_expired",
          campaignId,
          requestId: existing.id,
        },
        "Expired consent replaced with a fresh signed request"
      );
      if (afterRenewal) return finalize(afterRenewal);
    }

    // Lost the race: another request landed first. Converge when it is this exact request.
    if (
      afterRenewal &&
      afterRenewal.consentDigest?.toLowerCase() === digest.toLowerCase() &&
      afterRenewal.walletAddress.toLowerCase() === wallet
    ) {
      return finalize(afterRenewal);
    }

    throw new ValidationError(
      "A conflicting claim request was created concurrently. Please retry."
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
        return finalize(raced);
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

  return finalize(created);
}

/**
 * Stores a verified issuer approval, guarded so only a request still awaiting one is
 * advanced.
 *
 * Shared by the manual path (`submitIssuerApproval`, where the signature arrived from the
 * issuer's key) and the automatic path (`createConsent`, where the auto-approver produced
 * it), so both write the same fields under the same predicate. Returns the number of rows
 * advanced: zero means the request had already moved on (submitted or settled).
 */
async function storeVerifiedApproval(
  requestId: string,
  signature: string
): Promise<number> {
  const updated = await prisma.claimRequest.updateMany({
    where: {
      id: requestId,
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
  return updated.count;
}

/**
 * Verifies and stores the issuer approver's attestation.
 *
 * The signature must recover to the campaign's configured `issuerApprover`. It is never
 * produced by the backend: the issuer's key stays with the issuer (§10), and the software
 * only checks that what arrived is a valid approval over the stored request. An `auto`
 * campaign has no manual approval to submit - its approver key is Nomine's, not the
 * issuer's - so this path is refused and the consent path approves it instead.
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
  if (isAutoApprovalCampaign(campaign)) {
    throw new ValidationError(
      "This campaign approves automatically; no manual issuer approval is needed.",
      "campaign_auto_approval"
    );
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

  const updatedCount = await storeVerifiedApproval(request.id, signature);

  if (updatedCount === 0) {
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
