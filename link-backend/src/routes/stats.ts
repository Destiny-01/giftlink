import { Router } from "express";
import { getStatsOverviewHandler } from "../controllers/dropController";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.get("/overview", asyncHandler(getStatsOverviewHandler));

export default router;
