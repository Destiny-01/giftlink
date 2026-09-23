import { CronJob } from "cron";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { DropEventType, DropStatus } from "@prisma/client";
import { logger } from "../config/logger";
import { errorDiagnostics } from "../utils/safeLog";
import { fetchVerifiedCreation } from "../services/chainEvidence";

/**
 * Safety net for gifts that were funded on-chain but whose confirmation never reached the
 * API. It binds a pending gift only when the contract's own `DropCreated` event names the
 * same gift - same recipient commitment - so it cannot attach an unrelated funding event
 * to this row.
 *
 * Known gap, deliberately not repaired here (see the PR: the audit's general
 * event-indexer rebuild and claim reconciliation are out of this work package's scope):
 * `confirmDrop` writes `creationTxHash` and `ACTIVE` together, so no row matches this
 * job's query. A gift funded on-chain and never confirmed therefore stays `PENDING`, and
 * claims, revocations and expiry are still never reconciled from chain events.
 */
export const syncDropsJob = new CronJob("*/5 * * * *", async () => {
  try {
    const pendingDrops = await prisma.drop.findMany({
      where: {
        status: DropStatus.PENDING,
        creationTxHash: {
          not: null,
        },
      },
      take: 100,
    });

    if (pendingDrops.length === 0) {
      return;
    }

    logger.info(
      { operation: "syncDropsJob", outcome: "starting", count: pendingDrops.length },
      "Checking pending drops for confirmations"
    );

    for (const drop of pendingDrops) {
      if (!drop.creationTxHash) {
        continue;
      }

      try {
        const creation = await fetchVerifiedCreation(drop.creationTxHash, {
          contractAddress: env.GIFTLINK_CONTRACT_ADDRESS,
        });

        if (
          creation.recipientCommit.toLowerCase() !==
          drop.recipientCommit.toLowerCase()
        ) {
          logger.warn(
            {
              operation: "syncDropsJob",
              outcome: "commitment_mismatch",
              dropId: drop.id,
              txHash: creation.txHash,
            },
            "Funding transaction does not describe this gift; leaving it pending"
          );
          continue;
        }

        await prisma.$transaction(async (tx) => {
          await tx.drop.update({
            where: { id: drop.id },
            data: {
              onchainId: creation.onchainId,
              status: DropStatus.ACTIVE,
              updatedAt: new Date(),
            },
          });

          const existingEvent = await tx.dropEvent.findFirst({
            where: {
              dropId: drop.id,
              eventType: DropEventType.CREATED,
              txHash: creation.txHash,
            },
          });

          if (!existingEvent) {
            await tx.dropEvent.create({
              data: {
                dropId: drop.id,
                eventType: DropEventType.CREATED,
                actorAddress: creation.sender,
                txHash: creation.txHash,
                metadata: {
                  onchainId: creation.onchainId.toString(),
                  blockNumber: creation.blockNumber,
                  source: "syncDropsJob",
                },
              },
            });
          }
        });

        logger.info(
          {
            operation: "syncDropsJob",
            outcome: "synced",
            dropId: drop.id,
            onchainId: creation.onchainId.toString(),
          },
          "Synced drop with on-chain event"
        );
      } catch (error) {
        logger.error({
          operation: "syncDropsJob",
          outcome: "drop_failed",
          dropId: drop.id,
          ...errorDiagnostics(error),
        });
      }
    }
  } catch (error) {
    logger.error({
      operation: "syncDropsJob",
      outcome: "failure",
      ...errorDiagnostics(error),
    });
  }
});

export function startSyncDropsJob() {
  if (!syncDropsJob.running) {
    syncDropsJob.start();
    logger.info("Sync drops job started");
  }
}
