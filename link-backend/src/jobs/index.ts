import { startExpireDropsJob } from "./expireDropsJob";
import { startSyncDropsJob } from "./syncDropsJob";
import { startClaimIndexerJob } from "./claimIndexerJob";

export function startJobs() {
  startExpireDropsJob();
  startSyncDropsJob();
  startClaimIndexerJob();
}
