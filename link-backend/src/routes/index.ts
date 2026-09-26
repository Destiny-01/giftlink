import { Router } from "express";
import dropsRouter from "./drops";
import usersRouter from "./users";
import statsRouter from "./stats";
import campaignsRouter from "./campaigns";

const router = Router();

router.use("/drops", dropsRouter);
router.use("/users", usersRouter);
router.use("/stats", statsRouter);

// The Claim Core router defines its own full paths (`/campaigns/...` and `/inbox`), because
// the claimant inbox sits beside the campaign surface rather than under `/campaigns`.
router.use(campaignsRouter);

export default router;
