/**
 * Loading components
 */

import { Loader2 } from 'lucide-react';

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-white/[0.04] bg-card p-4">
      <div className="space-y-3">
        <div className="h-4 w-20 rounded bg-muted" />
        <div className="h-8 w-32 rounded bg-muted" />
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-3/4 rounded bg-muted" />
      </div>
    </div>
  );
}

export function FullPageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <Spinner className="mx-auto h-8 w-8 text-accent" />
        <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}
