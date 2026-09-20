/**
 * Global footer component
 */

import { Link } from "react-router-dom";
import { Github, Twitter } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-white/[0.04] bg-card">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          {/* Legal links */}
          <div className="flex gap-6 text-sm text-muted-foreground">
            <Link
              to="/terms"
              className="transition-colors hover:text-foreground"
            >
              Terms
            </Link>
            <Link
              to="/privacy"
              className="transition-colors hover:text-foreground"
            >
              Privacy
            </Link>
            <a
              href="https://docs.arc.network"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Docs
            </a>
          </div>

          {/* Social icons */}
          <div className="flex gap-4">
            <a
              href="https://twitter.com/DiacIcode"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground transition-colors hover:text-accent"
              aria-label="Twitter"
            >
              <Twitter className="h-5 w-5" />
            </a>
            <a
              href="https://github.com/Destiny-01/gift-link"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground transition-colors hover:text-accent"
              aria-label="GitHub"
            >
              <Github className="h-5 w-5" />
            </a>
          </div>
        </div>

        <div className="mt-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} GiftLink. Built on Arc Network.
        </div>
      </div>
    </footer>
  );
}
