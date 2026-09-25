import { CronJob } from "cron";
import { prisma } from "../config/prisma";
import { DropEventType, DropStatus } from "@prisma/client";
import { logger } from "../config/logger";
import { errorDiagnostics } from "../utils/safeLog";

export const expireDropsJob = new CronJob("0 * * * *", async () => {
  const now = new Date();
  try {
    const expiredDrops = await prisma.drop.findMany({
      where: {
        status: DropStatus.ACTIVE,
        expiry: {
          not: null,
          lte: now,
        },
      },
      select: {
        id: true,
      },
    });

    if (expiredDrops.length === 0) {
      return;
    }

    logger.info(
      { operation: "expireDropsJob", outcome: "starting", count: expiredDrops.length },
      "Found drops that have expired; updating status"
    );

    for (const drop of expiredDrops) {
      await prisma.$transaction([
        prisma.drop.update({
          where: { id: drop.id },
          data: {
            status: DropStatus.EXPIRED,
            updatedAt: now,
          },
        }),
        prisma.dropEvent.create({
          data: {
            dropId: drop.id,
            eventType: DropEventType.EXPIRED,
          },
        }),
      ]);
    }
  } catch (error) {
    logger.error(
      { operation: "expireDropsJob", outcome: "failure", ...errorDiagnostics(error) },
      "Expire drops job failed"
    );
  }
});

export function startExpireDropsJob() {
  if (!expireDropsJob.running) {
    expireDropsJob.start();
    logger.info("Expire drops job started");
  }
}
