import { Router } from "express";
import { env } from "../config/env";
import dropsRouter from "./drops";
import usersRouter from "./users";
import statsRouter from "./stats";
import campaignsRouter from "./campaigns";
import systemRouter from "./system";

const router = Router();

// The legacy GiftLink surface is mounted only when it is enabled. When it is off, `/drops`
// and `/stats` do not exist (a request is a plain 404) rather than being reachable-but-dead,
// so a testnet deployment cannot accidentally serve the legacy flow.
if (env.ENABLE_LEGACY_GIFTLINK) {
  router.use("/drops", dropsRouter);
  router.use("/stats", statsRouter);
}

// `/users` stays mounted regardless: the shared Privy auth endpoint lives here and the
// Nomine client still calls it (see the PR description for the endpoints the frontend uses).
router.use("/users", usersRouter);

// The Claim Core router defines its own full paths (`/campaigns/...` and `/inbox`), because
// the claimant inbox sits beside the campaign surface rather than under `/campaigns`.
router.use(campaignsRouter);

// Public config, health and the Studio access check.
router.use(systemRouter);

export default router;
