/**
 * Connect wallet button with OAuth options
 */

import { useState } from "react";
import { Wallet, ChevronDown, LogOut, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";
import { features } from "@/config/network";

export function ConnectWalletButton() {
  const { user, isAuthenticated, connectWallet, logout } = useAuth();

  if (!isAuthenticated || !user) {
    return (
      <div className="flex items-center gap-2">
        <Button
          onClick={connectWallet}
          className="bg-accent text-accent-foreground hover:bg-accent/90"
        >
          <Wallet className="mr-2 h-4 w-4" />
          Log In
        </Button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="flex items-center gap-2">
          <Avatar className="h-6 w-6">
            <AvatarFallback className="bg-accent text-accent-foreground text-xs">
              {user.name?.[0] || user.address?.slice(2, 4).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="hidden sm:inline">
            {user.name ||
              `${user.address?.slice(0, 6)}...${user.address?.slice(-4)}`}
          </span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="text-sm font-semibold">{user.name || "Anonymous"}</p>
          {user.address && (
            <p className="text-xs text-muted-foreground">
              {user.address.slice(0, 10)}...{user.address.slice(-8)}
            </p>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/inbox">Inbox</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/studio">Studio</Link>
        </DropdownMenuItem>
        {features.legacyGiftLink && (
          <DropdownMenuItem asChild>
            <Link to="/settings">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout} className="text-danger">
          <LogOut className="mr-2 h-4 w-4" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
