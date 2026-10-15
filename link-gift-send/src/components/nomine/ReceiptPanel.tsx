/**
 * Settlement receipt panel - the success card.
 *
 * Only ever rendered for a verified `Settlement` event to the exact wallet and amount. A signed
 * request or a transaction hash is not settlement and must not use this component.
 */

import { CircleCheckBig, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { explorerTxUrl, formatUsdcDisplay } from "@/lib/claimCore";
import { cn } from "@/lib/utils";
import { MonoValue } from "./MonoValue";
import type { SettlementReceipt } from "@/types/nomine";

interface NomineReceiptPanelProps {
  receipt?: SettlementReceipt | null;
  className?: string;
}

export function NomineReceiptPanel({ receipt, className }: NomineReceiptPanelProps) {
  if (!receipt) return null;

  const txUrl = explorerTxUrl(receipt.txHash);

  return (
    <Card className={cn("min-w-0 border border-success/30 bg-success/5 p-5", className)}>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
          <CircleCheckBig className="h-6 w-6" />
        </span>
        <p className="font-display text-lg font-semibold">
          {formatUsdcDisplay(receipt.amount)} sent to your wallet
        </p>
      </div>

      <dl className="grid gap-2 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Wallet</dt>
          <dd className="min-w-0 text-right">
            <MonoValue value={receipt.wallet} label="Wallet" />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Transaction</dt>
          <dd className="min-w-0 text-right">
            <MonoValue value={receipt.txHash} label="Transaction hash" />
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {txUrl ? (
          <a
            href={txUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            View on explorer
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
        {receipt.settledAt ? (
          <span className="text-xs text-muted-foreground">
            {new Date(receipt.settledAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        A verified on-chain settlement paid this amount to the wallet you signed with. Nomine never
        holds your funds.
      </p>
    </Card>
  );
}
