/**
 * Global header component
 */

import { Link } from 'react-router-dom';
import { Gift } from 'lucide-react';
import { ConnectWalletButton } from './ConnectWalletButton';

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.04] bg-background/80 backdrop-blur-lg">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link 
            to="/" 
            className="flex items-center gap-2 font-display text-xl font-bold transition-colors hover:text-accent"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-2">
              <Gift className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="hidden sm:inline">GiftLink</span>
          </Link>

          {/* Right side - Connect button */}
          <ConnectWalletButton />
        </div>
      </div>
    </header>
  );
}
