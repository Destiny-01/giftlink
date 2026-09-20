import { Router } from "express";
import dropsRouter from "./drops";
import usersRouter from "./users";
import statsRouter from "./stats";

const router = Router();

router.use("/drops", dropsRouter);
router.use("/users", usersRouter);
router.use("/stats", statsRouter);

export default router;
