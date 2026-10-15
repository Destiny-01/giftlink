/**
 * A surface's "coming soon" preview: the not-yet-built roadmap items that apply here.
 *
 * Rendered at the bottom of Studio and the Inbox. It reads the roadmap source of truth rather
 * than hard-coding copy, so a status change in `src/lib/roadmap.ts` moves an item between the
 * live product and this preview without touching a surface component.
 */

import { featuresForSurface, type RoadmapSurface } from "@/lib/roadmap";
import { LockedFeatureCard } from "./LockedFeatureCard";

interface FeaturePreviewProps {
  surface: RoadmapSurface;
  className?: string;
}

export function FeaturePreview({ surface, className }: FeaturePreviewProps) {
  const items = featuresForSurface(surface);
  if (items.length === 0) return null;

  return (
    <section aria-labelledby={`feature-preview-${surface}`} className={className}>
      <h2
        id={`feature-preview-${surface}`}
        className="font-display text-xl font-semibold"
      >
        Coming to Nomine
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Not built yet. Nothing here changes how Claims work today.
      </p>

      {/* One column on small screens: the 375px acceptance requires no horizontal overflow. */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <LockedFeatureCard key={item.id} title={item.title} blurb={item.blurb} />
        ))}
      </div>
    </section>
  );
}
