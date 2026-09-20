/**
 * Wallet selector component - allows users to choose which wallet to use
 */

import { Wallet, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { WalletBalance } from "@/hooks/useWalletBalances";

interface WalletSelectorProps {
  wallets: WalletBalance[];
  selectedWallet?: string;
  onSelectWallet: (address: string) => void;
  isLoading?: boolean;
}

export function WalletSelector({
  wallets,
  selectedWallet,
  onSelectWallet,
  isLoading = false,
}: WalletSelectorProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label className="text-sm font-medium">Select Wallet</Label>
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    );
  }

  if (wallets.length === 0) {
    return (
      <div className="space-y-2">
        <Label className="text-sm font-medium">Select Wallet</Label>
        <Card className="border border-white/[0.04] bg-card p-4 text-center">
          <p className="text-sm text-muted-foreground">
            No wallets available. Please connect a wallet.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Select Wallet</Label>
      <div className="space-y-2">
        {wallets.map((wallet) => {
          const isSelected = selectedWallet === wallet.address;
          const isDisabled = !wallet.isEnabled;

          return (
            <button
              key={wallet.address}
              type="button"
              onClick={() => !isDisabled && onSelectWallet(wallet.address)}
              disabled={isDisabled}
              className={cn(
                "w-full text-left",
                "rounded-lg border p-4 transition-all",
                "hover:border-accent/50 hover:bg-accent/5",
                isSelected && "border-accent bg-accent/10",
                isDisabled && "cursor-not-allowed opacity-50",
                !isDisabled &&
                  !isSelected &&
                  "border-white/[0.04] bg-surface/50"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg",
                      isSelected ? "bg-accent/20" : "bg-muted"
                    )}
                  >
                    <Wallet
                      className={cn(
                        "h-5 w-5",
                        isSelected ? "text-accent" : "text-muted-foreground"
                      )}
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">
                        {wallet.walletType === "privy"
                          ? "Embedded Wallet"
                          : "External Wallet"}
                      </p>
                      {isSelected && <Check className="h-4 w-4 text-accent" />}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {`${wallet.address.slice(0, 6)}...${wallet.address.slice(
                        -4
                      )}`}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p
                    className={cn(
                      "font-semibold",
                      isSelected ? "text-accent" : "text-foreground"
                    )}
                  >
                    {wallet.balance} USDC
                  </p>
                  {isDisabled && (
                    <p className="text-xs text-muted-foreground">
                      Insufficient balance
                    </p>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
