import { CronJob } from "cron";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { errorDiagnostics } from "../utils/safeLog";
import { getRpcProvider } from "../config/arcClient";
import { runClaimIndexerOnce } from "../services/claimIndexer";
import { assertClaimCoreConfiguration } from "../services/claimCoreEvidence";

/**
 * Runtime wiring for the Claim Core event indexer.
 *
 * The durable scan/checkpoint/replay path existed but was never started, so a campaign funded
 * on-chain could stay unbound locally and a settled entitlement could stay unconsumed in the
 * database until someone called the service by hand. This runs it on a schedule, asserts the Claim
 * Core configuration against the live chain first, and swallows a failing pass so one transient RPC
 * error cannot kill the worker.
 *
 * The checkpoint makes a restart safe: a pass that dies mid-way simply resumes from the last
 * recorded block, and every write is guarded so re-scanning is a no-op.
 */
export const claimIndexerJob = new CronJob("*/1 * * * *", async () => {
  try {
    const provider = getRpcProvider();
    await assertClaimCoreConfiguration(provider);

    const { scan, replay } = await runClaimIndexerOnce({ provider });
    if (
      scan.stored > 0 ||
      replay.funded > 0 ||
      replay.settled > 0 ||
      replay.reclaimed > 0
    ) {
      logger.info(
        { operation: "claimIndexerJob", outcome: "synced", ...scan, ...replay },
        "Claim Core events indexed"
      );
    }
  } catch (error) {
    logger.error({
      operation: "claimIndexerJob",
      outcome: "failure",
      ...errorDiagnostics(error),
    });
  }
});

export function startClaimIndexerJob() {
  if (!env.ENABLE_EVENT_LISTENER) {
    logger.info("Claim Core indexer job disabled by ENABLE_EVENT_LISTENER");
    return;
  }
  if (!claimIndexerJob.running) {
    claimIndexerJob.start();
    logger.info("Claim Core indexer job started");
  }
}
