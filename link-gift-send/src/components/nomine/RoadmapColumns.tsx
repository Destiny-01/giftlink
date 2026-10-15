/**
 * The three-column roadmap board (Live / Next / Later), shared by the Landing section and the
 * `/roadmap` page so the two never drift.
 *
 * Live items carry a check because they are shipped; the others carry the "Coming soon" badge.
 * The grid collapses to a single column below `md`, so it never overflows at 375px.
 */

import { Check } from "lucide-react";
import { itemsByStatus, type RoadmapStatus } from "@/lib/roadmap";
import { ComingSoonBadge } from "./ComingSoonBadge";

const COLUMNS: { status: RoadmapStatus; label: string; blurb: string }[] = [
  { status: "live", label: "Live", blurb: "Shipped and usable today." },
  { status: "next", label: "Next", blurb: "Actively planned. Not built yet." },
  { status: "later", label: "Later", blurb: "Considered, with no commitment." },
];

interface RoadmapColumnsProps {
  /**
   * The heading level for each column. Under the Landing section heading (an `h2`) they are
   * `h3`; on the standalone `/roadmap` page, where the columns follow the page `h1`, they are
   * `h2`, so the heading outline never skips a level.
   */
  headingLevel?: "h2" | "h3";
}

export function RoadmapColumns({ headingLevel = "h3" }: RoadmapColumnsProps) {
  const Heading = headingLevel;

  return (
    <div className="grid gap-10 md:grid-cols-3 md:gap-8">
      {COLUMNS.map((column) => (
        <section key={column.status}>
          <Heading className="font-display text-lg font-semibold">
            {column.label}
          </Heading>
          <p className="mt-1 text-sm text-muted-foreground">{column.blurb}</p>

          <ul className="mt-5 space-y-5">
            {itemsByStatus(column.status).map((item) => (
              <li key={item.id} className="border-t border-border pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  {item.status === "live" ? (
                    <Check
                      className="h-4 w-4 shrink-0 text-success"
                      aria-hidden="true"
                    />
                  ) : (
                    <ComingSoonBadge />
                  )}
                  <span className="font-medium">{item.title}</span>
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {item.blurb}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
