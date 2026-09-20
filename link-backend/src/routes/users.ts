import { Router } from "express";
import { getAllUserDropsHandler } from "../controllers/dropController";
import { authenticate as authenticateMiddleware } from "../middleware/auth";
import {
  validate,
  validateParams,
  validateQuery,
} from "../middleware/validator";
import { privyAuthSchema } from "../dto/user.dto";
import { authenticate } from "../controllers/userController";
import { userDropsQuerySchema } from "../dto/drop.dto";
import { asyncHandler } from "../utils/asyncHandler";
import { z } from "zod";

const router = Router();

const addressParamSchema = z.object({
  address: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address")
    .transform((val) => val.toLowerCase()),
});

router.post(
  "/authenticate",
  validate(privyAuthSchema),
  asyncHandler(authenticate)
);

router.get(
  "/:address/drops",
  authenticateMiddleware,
  validateParams(addressParamSchema),
  validateQuery(userDropsQuerySchema),
  asyncHandler(getAllUserDropsHandler)
);

export default router;
