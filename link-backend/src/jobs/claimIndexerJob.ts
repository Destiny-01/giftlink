import { CronJob } from "cron";
import type { JsonRpcProvider } from "ethers";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { errorDiagnostics } from "../utils/safeLog";
import { ConfigurationError } from "../utils/errors";
import { getIndexerProvider } from "../config/arcClient";
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
 *
 * Passes are single-flight. A catch-up over millions of blocks can outlast the one-minute cron
 * interval, and two overlapping passes would race on the same checkpoint and replay; a tick that
 * arrives while a pass is still running is skipped (logged at `debug`) rather than started.
 */

/**
 * The indexer's provider is pinned to `CHAIN_ID` and never asks the endpoint which chain it is
 * on, so ask once per pass: a misconfigured `RPC_URL` must stop the pass, not index another chain.
 */
async function assertIndexerChainId(provider: JsonRpcProvider): Promise<void> {
  const reported = BigInt(await provider.send("eth_chainId", []));
  if (reported !== BigInt(env.CHAIN_ID)) {
    throw new ConfigurationError(
      `RPC_URL reports chain id ${reported}, but CHAIN_ID is ${env.CHAIN_ID}. ` +
        "Refusing to index the wrong network."
    );
  }
}

/** The work one pass performs: verify the network and deployment, scan the chain, then replay. */
async function executeClaimIndexerPass(): Promise<void> {
  const provider = getIndexerProvider();
  await assertIndexerChainId(provider);
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
}

let passInFlight = false;

/**
 * Runs one indexer pass unless one is already in flight, returning whether a pass actually ran.
 *
 * The guard is a module-level flag rather than a database lease because the only caller is this
 * process's cron, so an in-process flag is the whole of the concurrency to exclude. A failing pass is
 * logged and swallowed so one transient RPC error cannot kill the worker.
 */
export async function runClaimIndexerPass(
  pass: () => Promise<void> = executeClaimIndexerPass
): Promise<boolean> {
  if (passInFlight) {
    logger.debug(
      { operation: "claimIndexerJob", outcome: "skipped" },
      "Claim Core indexer pass already in flight; skipping this tick"
    );
    return false;
  }

  passInFlight = true;
  try {
    await pass();
    return true;
  } catch (error) {
    logger.error({
      operation: "claimIndexerJob",
      outcome: "failure",
      ...errorDiagnostics(error),
    });
    return false;
  } finally {
    passInFlight = false;
  }
}

export const claimIndexerJob = new CronJob("*/1 * * * *", async () => {
  await runClaimIndexerPass();
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
