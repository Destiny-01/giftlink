/**
 * A muted card for an unshipped feature.
 *
 * Deliberately inert: it is not a link, it is not a button and it does nothing on click. The
 * card carries `aria-disabled` so assistive technology is told the same thing the muted styling
 * says visually. The only interactive element is the optional "Tell me when it's ready" link,
 * which goes somewhere real.
 */

import { Lock } from "lucide-react";
import { ComingSoonBadge } from "./ComingSoonBadge";

interface LockedFeatureCardProps {
  title: string;
  blurb: string;
  /** Hide the notify link on surfaces where it would be noise. */
  showNotifyLink?: boolean;
  className?: string;
}

export const NOTIFY_URL = "https://x.com/usenomine";

export function LockedFeatureCard({
  title,
  blurb,
  showNotifyLink = true,
  className,
}: LockedFeatureCardProps) {
  return (
    <div
      aria-disabled="true"
      className={`rounded-lg border border-border bg-surface/50 p-4 ${
        className ?? ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium text-foreground">{title}</span>
        </div>
        <ComingSoonBadge />
      </div>

      <p className="mt-2 text-sm leading-6 text-muted-foreground">{blurb}</p>

      {showNotifyLink ? (
        <a
          href={NOTIFY_URL}
          target="_blank"
          rel="noopener"
          className="mt-3 inline-block text-sm text-accent hover:underline"
        >
          Tell me when it&apos;s ready
        </a>
      ) : null}
    </div>
  );
}
