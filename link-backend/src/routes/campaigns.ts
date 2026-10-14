import { Router } from "express";
import {
  campaignIdParamSchema,
  campaignRequestParamSchema,
  confirmCampaignSchema,
  consentSchema,
  issuerApprovalSchema,
  prepareCampaignSchema,
  reclaimConfirmSchema,
} from "../dto/campaign.dto";
import {
  confirmCampaignHandler,
  consentHandler,
  getCampaignHandler,
  getRequestHandler,
  inboxHandler,
  issuerApprovalHandler,
  listCampaignRequestsHandler,
  listCampaignsHandler,
  prepareCampaignHandler,
  publicCampaignHandler,
  reclaimConfirmHandler,
  settleRequestHandler,
} from "../controllers/campaignController";
import { authenticate, optionalAuthenticate } from "../middleware/auth";
import { validate, validateParams } from "../middleware/validator";
import {
  claimPermitLimiter,
  dropMutationLimiter,
} from "../middleware/rateLimiter";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * Nomine Claim Core routes (`docs/nomine-claim-core-integration.md` §8).
 *
 * The paths are defined in full (`/campaigns/...` and `/inbox`) and this router is mounted at
 * the API root, because the claimant's inbox lives beside the campaign surface rather than
 * under it. Every route is authenticated and ownership-checked except the public link view.
 */
const router = Router();

// ---------------------------------------------------------------------------
// Issuer (Studio)
// ---------------------------------------------------------------------------

router.post(
  "/campaigns/prepare",
  dropMutationLimiter,
  authenticate,
  validate(prepareCampaignSchema),
  asyncHandler(prepareCampaignHandler)
);

router.post(
  "/campaigns/:id/confirm",
  dropMutationLimiter,
  authenticate,
  validateParams(campaignIdParamSchema),
  validate(confirmCampaignSchema),
  asyncHandler(confirmCampaignHandler)
);

router.get(
  "/campaigns",
  authenticate,
  asyncHandler(listCampaignsHandler)
);

router.get(
  "/campaigns/:id",
  authenticate,
  validateParams(campaignIdParamSchema),
  asyncHandler(getCampaignHandler)
);

router.get(
  "/campaigns/:id/requests",
  authenticate,
  validateParams(campaignIdParamSchema),
  asyncHandler(listCampaignRequestsHandler)
);

// The issuer's key signs an approval here; the backend only verifies and stores it, so this
// is a real human action through a known channel and is rate limited like the other
// authority steps.
router.post(
  "/campaigns/:id/requests/:requestId/issuer-approval",
  claimPermitLimiter,
  authenticate,
  validateParams(campaignRequestParamSchema),
  validate(issuerApprovalSchema),
  asyncHandler(issuerApprovalHandler)
);

// Recovery needs no approver and no consent, only the issuer and expiry.
router.post(
  "/campaigns/:id/recover/confirm",
  dropMutationLimiter,
  authenticate,
  validateParams(campaignIdParamSchema),
  validate(reclaimConfirmSchema),
  asyncHandler(reclaimConfirmHandler)
);

// ---------------------------------------------------------------------------
// Claimant (Inbox) and public
// ---------------------------------------------------------------------------

// The public link view carries no roster, so it needs no authentication.
router.get(
  "/campaigns/:id/public",
  optionalAuthenticate(),
  validateParams(campaignIdParamSchema),
  asyncHandler(publicCampaignHandler)
);

router.get("/inbox", authenticate, asyncHandler(inboxHandler));

router.post(
  "/campaigns/:id/consent",
  claimPermitLimiter,
  authenticate,
  validateParams(campaignIdParamSchema),
  validate(consentSchema),
  asyncHandler(consentHandler)
);

router.get(
  "/campaigns/:id/requests/:requestId",
  authenticate,
  validateParams(campaignRequestParamSchema),
  asyncHandler(getRequestHandler)
);

// The sponsored relay is the one path that moves campaign USDC, so it is authenticated and
// limited like a claim.
router.post(
  "/campaigns/:id/requests/:requestId/settle",
  claimPermitLimiter,
  authenticate,
  validateParams(campaignRequestParamSchema),
  asyncHandler(settleRequestHandler)
);

export default router;
