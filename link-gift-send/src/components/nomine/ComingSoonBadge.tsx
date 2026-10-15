/**
 * "Coming soon" marker for unshipped features.
 *
 * Uses only approved identity tokens (`brand/approved/GUIDELINES.md`): limestone #E5E1D8
 * background, onyx #0B0B0D text, 3px radius, Instrument Sans 550 - the same treatment as
 * `TestnetPill`, so no new colour is introduced.
 */

import { cn } from "@/lib/utils";

interface ComingSoonBadgeProps {
  className?: string;
}

export function ComingSoonBadge({ className }: ComingSoonBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap bg-[#E5E1D8] px-1.5 py-0.5 text-[11px] leading-none text-[#0B0B0D]",
        className
      )}
      style={{ borderRadius: 3, fontWeight: 550 }}
    >
      Coming soon
    </span>
  );
}
