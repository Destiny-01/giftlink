import { Response } from "express";
import {
  confirmCampaignFunding,
  confirmCampaignReclaim,
  getIssuerCampaign,
  getPublicCampaign,
  listCampaignRequests,
  listInbox,
  listIssuerCampaigns,
  prepareCampaign,
} from "../services/campaignService";
import {
  createConsent,
  getCampaignRequestDetail,
  submitIssuerApproval,
} from "../services/claimRequestService";
import { settleClaim } from "../services/claimRelayService";
import { logger } from "../config/logger";
import type {
  ConfirmCampaignRequest,
  ConsentRequest,
  IssuerApprovalRequest,
  PrepareCampaignRequest,
  ReclaimConfirmRequest,
} from "../dto/campaign.dto";
import { AuthRequest } from "../middleware/auth";
import { ForbiddenError } from "../utils/errors";
import { errorDiagnostics } from "../utils/safeLog";

/**
 * HTTP surface for the Nomine Claim Core integration.
 *
 * These handlers only translate transport to service calls: ownership, chain verification
 * and the workflow rules all live in the services, where the same checks apply however the
 * endpoint is reached.
 */

function requireAuthUser(req: AuthRequest) {
  if (!req.authUser?.privyUserId) {
    throw new ForbiddenError("Authenticated user is required");
  }
  return req.authUser;
}

// ---------------------------------------------------------------------------
// Issuer (Studio)
// ---------------------------------------------------------------------------

export async function prepareCampaignHandler(req: AuthRequest, res: Response) {
  const body = req.body as PrepareCampaignRequest;
  const result = await prepareCampaign(body, requireAuthUser(req));
  res.status(201).json(result);
}

export async function confirmCampaignHandler(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const { txHash } = req.body as ConfirmCampaignRequest;
  const result = await confirmCampaignFunding(id, txHash, requireAuthUser(req));
  res.json(result);
}

export async function listCampaignsHandler(req: AuthRequest, res: Response) {
  const result = await listIssuerCampaigns(requireAuthUser(req));
  res.json(result);
}

export async function getCampaignHandler(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const result = await getIssuerCampaign(id, requireAuthUser(req));
  res.json(result);
}

export async function listCampaignRequestsHandler(
  req: AuthRequest,
  res: Response
) {
  const { id } = req.params;
  const result = await listCampaignRequests(id, requireAuthUser(req));
  res.json(result);
}

export async function issuerApprovalHandler(req: AuthRequest, res: Response) {
  const { id, requestId } = req.params;
  const { signature } = req.body as IssuerApprovalRequest;
  const result = await submitIssuerApproval(
    id,
    requestId,
    signature,
    requireAuthUser(req)
  );
  res.json(result);
}

export async function reclaimConfirmHandler(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const { txHash } = req.body as ReclaimConfirmRequest;
  const result = await confirmCampaignReclaim(id, txHash, requireAuthUser(req));
  res.json(result);
}

// ---------------------------------------------------------------------------
// Claimant (Inbox) and public
// ---------------------------------------------------------------------------

export async function publicCampaignHandler(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const result = await getPublicCampaign(id);
  res.json(result);
}

export async function inboxHandler(req: AuthRequest, res: Response) {
  const result = await listInbox(requireAuthUser(req));
  res.json(result);
}

export async function consentHandler(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const body = req.body as ConsentRequest;
  const authUser = requireAuthUser(req);
  const receipt = await createConsent(id, body, authUser);

  if (receipt.approvalMode !== "auto") {
    res.status(201).json(receipt);
    return;
  }

  // Auto mode: the consent was approved automatically, so pay out immediately. The settled
  // receipt (200) and, on failure, the ISSUER_APPROVED receipt (200) both describe the same
  // request, so a client can branch on `settleError` rather than on the status code. A
  // settlement failure must not lose the approval: the caller gets a machine-readable
  // `settleError`, and the idempotent `/settle` endpoint is the retry.
  try {
    const settled = await settleClaim(id, receipt.requestId, authUser);
    res.status(200).json({ ...settled, approvalMode: receipt.approvalMode });
  } catch (error) {
    const diagnostics = errorDiagnostics(error);
    logger.error({
      operation: "consentHandler",
      outcome: "auto_settle_failed",
      campaignId: id,
      requestId: receipt.requestId,
      ...diagnostics,
    });
    res.status(200).json({
      ...receipt,
      settleError: {
        code: diagnostics.errorCode ?? diagnostics.errorType,
        message: diagnostics.error,
      },
    });
  }
}

export async function getRequestHandler(req: AuthRequest, res: Response) {
  const { id, requestId } = req.params;
  const result = await getCampaignRequestDetail(
    id,
    requestId,
    requireAuthUser(req)
  );
  res.json(result);
}

export async function settleRequestHandler(req: AuthRequest, res: Response) {
  const { id, requestId } = req.params;
  const result = await settleClaim(id, requestId, requireAuthUser(req));
  res.json(result);
}
