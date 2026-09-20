import { startExpireDropsJob } from "./expireDropsJob";
import { startSyncDropsJob } from "./syncDropsJob";

export function startJobs() {
  startExpireDropsJob();
  startSyncDropsJob();
}
