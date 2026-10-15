/**
 * Roadmap - the full-page view of what is live and what is coming.
 *
 * Same source of truth and same three columns as the Landing section, rendered on its own page
 * so it can be linked directly. No dates and no promises beyond the order shown.
 */

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { RoadmapColumns } from "@/components/nomine";

export default function Roadmap() {
  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="px-4 pt-28 pb-16 sm:pt-36 sm:pb-24">
        <div className="container mx-auto max-w-5xl">
          <p className="font-mono text-sm uppercase tracking-[0.2em] text-accent-2">
            Nomine
          </p>
          <h1 className="mt-6 font-display text-4xl leading-tight tracking-tight sm:text-5xl">
            Roadmap
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground">
            What is live today, and what is coming next. Live items are shipped;
            everything else is clearly marked. Nothing here carries a date or a
            promise beyond the order shown.
          </p>

          <div className="mt-14">
            <RoadmapColumns headingLevel="h2" />
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
