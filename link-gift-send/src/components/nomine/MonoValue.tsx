/**
 * MonoValue - a machine string (address, hash, digest) that can never overflow its container.
 *
 * Shows the first 6 and last 4 characters by default, keeps the full value in the `title` attribute,
 * and offers a copy button. Tapping the value expands it to the full string, which then wraps with
 * `break-all` rather than pushing the layout wide. At 375px this is the difference between a readable
 * card and a horizontally scrolling page.
 */

import { useState } from "react";
import { Copy } from "lucide-react";
import { useClipboard } from "@/hooks/useClipboard";
import { truncateMono } from "@/lib/mono";
import { cn } from "@/lib/utils";

interface MonoValueProps {
  value?: string | null;
  /** Used in the copy toast and the copy button's accessible name. */
  label?: string;
  className?: string;
}

export function MonoValue({ value, label = "Value", className }: MonoValueProps) {
  const [expanded, setExpanded] = useState(false);
  const { copyToClipboard } = useClipboard();

  if (!value) return <span className="text-muted-foreground">—</span>;

  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1", className)}>
      <button
        type="button"
        title={value}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className={cn(
          "min-w-0 text-left font-mono",
          expanded ? "whitespace-normal break-all" : "truncate"
        )}
      >
        {expanded ? value : truncateMono(value)}
      </button>
      <button
        type="button"
        title={`Copy ${label}`}
        aria-label={`Copy ${label}`}
        onClick={() => copyToClipboard(value, `${label} copied`)}
        className="-m-1 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
