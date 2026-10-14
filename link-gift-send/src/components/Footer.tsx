/**
 * Global footer component
 */

import { Link } from "react-router-dom";

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="container mx-auto px-4 py-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <img
              src="/brand/nomine-lockup-ivory.svg"
              alt="Nomine"
              width={103}
              height={26}
              className="h-6 w-auto"
            />
            <p className="text-sm text-muted-foreground">Value, addressed.</p>
          </div>

          <nav aria-label="Footer" className="flex flex-col gap-3 text-sm sm:items-end">
            <Link
              to="/app?next=/inbox"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Open Inbox
            </Link>
            <a
              href="https://github.com/Destiny-01/giftlink"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Source repository
            </a>
          </nav>
        </div>

        <div className="mt-8 space-y-1 border-t border-border pt-6 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} Nomine.</p>
          <p>GiftLink by Nomine is the gifting application that started this work.</p>
        </div>
      </div>
    </footer>
  );
}
