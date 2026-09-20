import { CronJob } from "cron";
import { Contract } from "ethers";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { GiftLinkABI } from "../config/abi";
import { rpcProvider } from "../config/arcClient";
import { DropEventType, DropStatus } from "@prisma/client";
import { logger } from "../config/logger";

const contract = new Contract(
  env.GIFTLINK_CONTRACT_ADDRESS,
  GiftLinkABI,
  rpcProvider
);

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
      { count: pendingDrops.length },
      "Sync job: checking pending drops for confirmations"
    );

    for (const drop of pendingDrops) {
      if (!drop.creationTxHash) {
        continue;
      }

      try {
        const receipt = await rpcProvider.getTransactionReceipt(
          drop.creationTxHash
        );

        if (!receipt || receipt.status !== 1) {
          continue;
        }

        const logs = await contract.queryFilter(
          contract.filters.DropCreated(),
          receipt.blockNumber,
          receipt.blockNumber
        );

        const event = logs.find(
          (log) => log.transactionHash === drop.creationTxHash
        ) as { args?: { dropId: bigint } } | undefined;

        if (!event || !event.args) {
          continue;
        }

        const onchainDropId = event.args.dropId;

        await prisma.$transaction(async (tx) => {
          await tx.drop.update({
            where: { id: drop.id },
            data: {
              onchainId: onchainDropId,
              status: DropStatus.ACTIVE,
              updatedAt: new Date(),
            },
          });

          const existingEvent = await tx.dropEvent.findFirst({
            where: {
              dropId: drop.id,
              eventType: DropEventType.CREATED,
              txHash: drop.creationTxHash,
            },
          });

          if (!existingEvent) {
            await tx.dropEvent.create({
              data: {
                dropId: drop.id,
                eventType: DropEventType.CREATED,
                txHash: drop.creationTxHash,
              },
            });
          }
        });

        logger.info(
          { dropId: drop.id, onchainId: onchainDropId.toString() },
          "Synced drop with on-chain event"
        );
      } catch (error) {
        logger.error({ error, dropId: drop.id }, "Error syncing pending drop");
      }
    }
  } catch (error) {
    logger.error({ error }, "Error executing sync drops job");
  }
});

export function startSyncDropsJob() {
  if (!syncDropsJob.running) {
    syncDropsJob.start();
    logger.info("Sync drops job started");
  }
}
