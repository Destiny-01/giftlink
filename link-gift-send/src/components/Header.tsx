/**
 * Global header component
 */

import { Link } from 'react-router-dom';
import { ConnectWalletButton } from './ConnectWalletButton';
import { TestnetPill } from './TestnetPill';
import { useAuth } from '@/hooks/useAuth';

export function Header() {
  const { isAuthenticated } = useAuth();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/85 backdrop-blur">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between gap-4">
          <Link
            to="/"
            aria-label="Nomine home"
            className="flex shrink-0 items-center"
          >
            <img
              src="/brand/nomine-symbol-ivory.svg"
              alt=""
              width={28}
              height={28}
              className="h-7 w-7 sm:hidden"
            />
            <img
              src="/brand/nomine-lockup-ivory.svg"
              alt=""
              width={111}
              height={28}
              className="hidden h-7 w-auto sm:block"
            />
          </Link>

          <nav aria-label="Main" className="flex items-center gap-3 sm:gap-4">
            <TestnetPill />
            <Link
              to="/roadmap"
              className="whitespace-nowrap text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Roadmap
            </Link>
            {isAuthenticated && (
              <>
                {/*
                  Inbox and Studio also live in the account menu, so on the narrowest screens
                  they are hidden to keep the bar (which now carries the Roadmap link) from
                  overflowing at 375px.
                */}
                <Link
                  to="/inbox"
                  className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
                >
                  Inbox
                </Link>
                <Link
                  to="/studio"
                  className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
                >
                  Studio
                </Link>
              </>
            )}
            <ConnectWalletButton />
          </nav>
        </div>
      </div>
    </header>
  );
}
