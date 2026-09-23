import { Router } from "express";
import {
  claimPermitSchema,
  claimConfirmSchema,
  confirmDropSchema,
  prepareDropSchema,
  relayClaimSchema,
  revokeDropSchema,
  updateReceiverSchema,
} from "../dto/drop.dto";
import {
  confirmDropHandler,
  getDropDetailsHandler,
  issueClaimPermitHandler,
  prepareDropHandler,
  recordDropClaimHandler,
  relayClaimHandler,
  revokeDropHandler,
  updateReceiverHandler,
} from "../controllers/dropController";
import { authenticate, optionalAuthenticate } from "../middleware/auth";
import { validate, validateParams } from "../middleware/validator";
import {
  claimPermitLimiter,
  dropMutationLimiter,
} from "../middleware/rateLimiter";
import { asyncHandler } from "../utils/asyncHandler";
import { z } from "zod";

const router = Router();

const dropIdParamSchema = z.object({
  id: z.string().uuid(),
});

router.post(
  "/prepare",
  dropMutationLimiter,
  authenticate,
  validate(prepareDropSchema),
  asyncHandler(prepareDropHandler)
);

router.post(
  "/confirm",
  dropMutationLimiter,
  authenticate,
  validate(confirmDropSchema),
  asyncHandler(confirmDropHandler)
);

router.get(
  "/:id",
  optionalAuthenticate,
  validateParams(dropIdParamSchema),
  asyncHandler(getDropDetailsHandler)
);

router.post(
  "/:id/claim-permit",
  claimPermitLimiter,
  authenticate,
  validateParams(dropIdParamSchema),
  validate(claimPermitSchema),
  asyncHandler(issueClaimPermitHandler)
);

// The relay endpoint is the one path that moves USDC, so it now authenticates like every
// other mutation on this router. Authorization itself lives in the shared recipient policy
// that both this route and the permit route use.
router.post(
  "/:id/relay-claim",
  claimPermitLimiter,
  authenticate,
  validateParams(dropIdParamSchema),
  validate(relayClaimSchema),
  asyncHandler(relayClaimHandler)
);

router.post(
  "/:id/claimed",
  dropMutationLimiter,
  authenticate,
  validateParams(dropIdParamSchema),
  validate(claimConfirmSchema),
  asyncHandler(recordDropClaimHandler)
);

router.post(
  "/:id/update-receiver",
  dropMutationLimiter,
  authenticate,
  validateParams(dropIdParamSchema),
  validate(updateReceiverSchema),
  asyncHandler(updateReceiverHandler)
);

router.post(
  "/:id/revoke",
  dropMutationLimiter,
  authenticate,
  validate(revokeDropSchema),
  asyncHandler(revokeDropHandler)
);

export default router;
