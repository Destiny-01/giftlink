/**
 * Settlement receipt panel.
 *
 * Only ever rendered for a verified `Settlement` event to the exact wallet and amount. A signed
 * request or a transaction hash is not settlement and must not use this component.
 */

import { ExternalLink, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatUsdcDisplay, explorerTxUrl, shortenAddress } from "@/lib/claimCore";
import type { SettlementReceipt } from "@/types/nomine";

interface NomineReceiptPanelProps {
  receipt?: SettlementReceipt | null;
  className?: string;
}

export function NomineReceiptPanel({ receipt, className }: NomineReceiptPanelProps) {
  if (!receipt) return null;

  const txUrl = explorerTxUrl(receipt.txHash);

  return (
    <Card className={`border border-success/30 bg-success/5 p-4 ${className ?? ""}`}>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-success">
        <ShieldCheck className="h-4 w-4" />
        Settlement receipt
      </div>

      <dl className="grid gap-2 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Amount (direct USDC payout)</dt>
          <dd className="font-mono">{formatUsdcDisplay(receipt.amount)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Paid to</dt>
          <dd className="font-mono">{shortenAddress(receipt.wallet, 6)}</dd>
        </div>
        {receipt.blockNumber ? (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Block</dt>
            <dd className="font-mono">{receipt.blockNumber}</dd>
          </div>
        ) : null}
        {receipt.settledAt ? (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Settled</dt>
            <dd>{new Date(receipt.settledAt).toLocaleString()}</dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Transaction</dt>
          <dd>
            {txUrl ? (
              <a
                href={txUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-accent hover:underline"
              >
                {shortenAddress(receipt.txHash, 8)}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="font-mono">{shortenAddress(receipt.txHash, 8)}</span>
            )}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-muted-foreground">
        This entitlement is consumed because a verified Settlement event paid the exact amount to
        the exact wallet. Sponsor gas is tracked separately and is never part of campaign funding.
      </p>
    </Card>
  );
}
