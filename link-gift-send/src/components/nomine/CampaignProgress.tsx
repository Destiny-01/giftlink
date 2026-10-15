/**
 * CampaignProgress - the shared "how far along is this campaign" line and bar.
 *
 * Used by the campaign detail header and by every card in the campaign list, so the two can never
 * disagree about what "2 of 5" means.
 */

import { Progress } from "@/components/ui/progress";
import { formatUsdcFixed } from "@/lib/claimCore";
import { cn } from "@/lib/utils";

interface CampaignProgressProps {
  /** Entitlements consumed by a verified settlement. */
  claimed: number;
  /** Total entitlements in the campaign. */
  total: number;
  /** Settled amount, in USDC base units. */
  settled: string;
  /** Funded budget, in USDC base units. */
  budget: string;
  className?: string;
}

export function CampaignProgress({
  claimed,
  total,
  settled,
  budget,
  className,
}: CampaignProgressProps) {
  const safeTotal = Math.max(0, total);
  const safeClaimed = Math.max(0, Math.min(claimed, safeTotal));
  const percent = safeTotal > 0 ? (safeClaimed / safeTotal) * 100 : 0;

  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
        <span>
          {safeClaimed} of {safeTotal} claimed
        </span>
        <span className="min-w-0 break-words">
          {formatUsdcFixed(settled)} / {formatUsdcFixed(budget)} USDC paid
        </span>
      </div>
      <Progress
        value={percent}
        className="h-2"
        aria-label={`${safeClaimed} of ${safeTotal} claimed`}
      />
    </div>
  );
}
