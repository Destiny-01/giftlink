import { env } from "../config/env";
import { startExpireDropsJob } from "./expireDropsJob";
import { startSyncDropsJob } from "./syncDropsJob";
import { startClaimIndexerJob } from "./claimIndexerJob";

export function startJobs() {
  // The legacy gift jobs only exist while legacy support is enabled. Starting them with the
  // legacy contract disabled would have them scan a deployment that is not configured.
  if (env.ENABLE_LEGACY_GIFTLINK) {
    startExpireDropsJob();
    startSyncDropsJob();
  }
  startClaimIndexerJob();
}
