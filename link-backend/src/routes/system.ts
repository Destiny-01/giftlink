import { Router } from "express";
import {
  getConfigHandler,
  getHealthHandler,
  getStudioAccessHandler,
} from "../controllers/systemController";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * Public configuration, the hosting health probe, and the Studio access check.
 *
 * `/config` and `/health` are public: a client needs the network identity before it can
 * authenticate, and a hosting platform probes health without credentials. `/studio/access`
 * answers for one authenticated caller, so it requires a session.
 */
const router = Router();

router.get("/config", asyncHandler(getConfigHandler));
router.get("/health", asyncHandler(getHealthHandler));
router.get("/studio/access", authenticate, asyncHandler(getStudioAccessHandler));

export default router;
