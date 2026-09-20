/**
 * Balance display card
 */

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface BalanceCardProps {
  balance: string;
  currency?: string;
  isLoading?: boolean;
  onAddFunds?: () => void;
}

export function BalanceCard({
  balance,
  currency = "USDC",
  isLoading = false,
  onAddFunds,
}: BalanceCardProps) {
  return (
    <Card className="relative overflow-hidden border border-white/[0.04] bg-gradient-to-br from-card to-surface p-6 shadow-[0_6px_30px_rgba(1,8,16,0.6)]">
      {/* Glow effect */}
      <div className="absolute -right-20 -top-20 h-40 w-40 rounded-full bg-accent/10 blur-3xl" />

      <div className="relative">
        <p className="text-sm font-medium text-muted-foreground">
          Total Balance
        </p>
        <div className="mt-2 flex items-baseline gap-2">
          {isLoading ? (
            <>
              <Skeleton className="h-14 w-48" />
              <Skeleton className="h-7 w-16" />
            </>
          ) : (
            <>
              <span className="font-display text-5xl font-bold tracking-tight">
                {parseFloat(balance).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <span className="text-xl font-semibold text-muted-foreground">
                {currency}
              </span>
            </>
          )}
        </div>

        {onAddFunds && (
          <Button
            onClick={onAddFunds}
            variant="outline"
            size="sm"
            className="mt-4 border-accent/20 text-accent hover:bg-accent/10"
            disabled={isLoading}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Funds
          </Button>
        )}
      </div>
    </Card>
  );
}
