/**
 * ClaimAction - the one button a claimant presses.
 *
 * Signing consent, posting it, and triggering the sponsored payout are one action with one primary
 * button; the technical facts (campaign, wallet, deadline, contract) live in a collapsed `Details`
 * disclosure rather than a wall of fields. Shared verbatim by the Inbox and the campaign link so the
 * claim logic exists once.
 *
 * The wallet list is passed in rather than read here, so a list of cards performs a single balance
 * read instead of one per card.
 *
 * This component never starts a payout on its own: rendering a card must not POST `/settle`. The
 * settlement is triggered by the button press (inside the flow) or by an explicit retry.
 */

import { useEffect, useMemo, useRef } from "react";
import { RefreshCw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/Loader";
import type { WalletBalance } from "@/hooks/useWalletBalances";
import { useOneClickClaim } from "@/hooks/useOneClickClaim";
import { useConfetti } from "@/hooks/useConfetti";
import { pickCurrentRequest, settlementReceiptFor, describeClaimStatus } from "@/lib/claimFlow";
import {
  defaultConsentDeadline,
  formatTimestampWithTimezone,
  formatUsdcDisplay,
  isClaimCoreConfigured,
} from "@/lib/claimCore";
import { cn } from "@/lib/utils";
import { NomineReceiptPanel } from "./ReceiptPanel";
import {
  D006_NOTICE,
  ISSUER_CONFIRMATION_NOTICE,
  NomineDetails,
  NomineFactRow,
  WALLET_CHANGE_NOTICE,
} from "./Disclosure";
import { MonoValue } from "./MonoValue";
import type { NomineEntitlement, SigningWallet } from "@/types/nomine";

interface ClaimActionProps {
  entitlement: NomineEntitlement;
  wallets: WalletBalance[];
  walletsLoading?: boolean;
  /** Called once after a verified settlement so the parent can refresh. */
  onSettled?: () => void;
  className?: string;
}

/** The embedded wallet first, then any funded wallet: the claimant should not have to choose. */
function resolveSigningWallet(wallets: WalletBalance[]): SigningWallet | null {
  const pick =
    wallets.find((w) => w.walletType === "privy" && w.isEnabled) ??
    wallets.find((w) => w.isEnabled) ??
    wallets.find((w) => w.walletType === "privy") ??
    wallets[0];
  if (!pick?.address) return null;
  return {
    address: pick.address as `0x${string}`,
    walletType: pick.walletType,
  };
}

export function ClaimAction({
  entitlement,
  wallets,
  walletsLoading = false,
  onSettled,
  className,
}: ClaimActionProps) {
  const { step, request, error, isBusy, claim, retryPayout } = useOneClickClaim();
  const { fireConfetti } = useConfetti();
  const settledOnce = useRef(false);

  const wallet = useMemo(() => resolveSigningWallet(wallets), [wallets]);
  const configured = isClaimCoreConfigured();

  // The most advanced of the local flow result and the server's last known state; a stale local
  // result must not outlive a poll that has moved the claim on.
  const current = pickCurrentRequest(entitlement.request, request);
  const status = current?.status ?? null;
  const receipt = current?.receipt ?? settlementReceiptFor(entitlement);

  const settled =
    status === "SETTLED" ||
    Boolean(receipt) ||
    step === "settled" ||
    entitlement.status === "COMPLETED";
  const hasRequest = Boolean(current?.id);
  /**
   * A failure with a request behind it is a payout failure, so the retry is a payout retry. A
   * failure with no request is a signing failure, so the retry is a fresh claim. Either way the
   * copy table's FAILED state ("Something went wrong") is what the claimant sees - never a payout
   * failure dressed up as "Sending your USDC…".
   */
  const payoutFailed =
    (step === "failed" && hasRequest) ||
    status === "FAILED" ||
    Boolean(current?.settleError);
  const waiting = !payoutFailed && status === "CONSENTED";
  const sending = !payoutFailed && (status === "ISSUER_APPROVED" || status === "SUBMITTED");
  const expired =
    !payoutFailed && (status === "EXPIRED" || entitlement.status === "EXPIRED");

  const opensAt = entitlement.opensAt ?? entitlement.campaign?.openingTime ?? 0;
  // D-020: a funded claim before its opening time is Available but not claimable. Guarding here
  // rather than only in the Inbox means a shared `ClaimAction` cannot offer a premature button.
  const preOpening = !hasRequest && opensAt > 0 && opensAt > Math.floor(Date.now() / 1000);

  const manual = entitlement.campaign?.approvalMode === "manual";

  const deadline =
    current?.deadline ??
    defaultConsentDeadline(entitlement.campaign?.expiryTime ?? null);

  // Fire once, and only for a settlement this session produced - never on load for an item that was
  // already settled before the page opened.
  useEffect(() => {
    if (step !== "settled" || settledOnce.current) return;
    settledOnce.current = true;
    fireConfetti();
    onSettled?.();
  }, [step, fireConfetti, onSettled]);

  if (settled) {
    return (
      <div className={cn("min-w-0", className)}>
        <div className="mb-2 text-sm font-medium text-success">Paid</div>
        {receipt ? (
          <NomineReceiptPanel receipt={receipt} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Your claim is paid. Refresh to see the receipt.
          </p>
        )}
      </div>
    );
  }

  if (preOpening) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        Claiming opens {formatTimestampWithTimezone(opensAt)}.
      </p>
    );
  }

  const primaryLabel = isBusy
    ? step === "preparing"
      ? "Preparing…"
      : "Sending your USDC…"
    : `Claim ${formatUsdcDisplay(entitlement.amount)}`;
  const canClaim = Boolean(wallet) && configured && !walletsLoading;

  return (
    <div className={cn("min-w-0 space-y-3", className)}>
      {payoutFailed ? (
        <p className="text-sm text-muted-foreground">Something went wrong</p>
      ) : waiting || sending || expired ? (
        <p className="text-sm text-muted-foreground">
          {describeClaimStatus(status, entitlement.campaign?.issuerName)}
        </p>
      ) : manual ? (
        // D-019: the confirmation requirement is disclosed before consent is requested, not only
        // inside the collapsed Details.
        <p className="text-sm text-muted-foreground">
          The issuer confirms your claim before it&apos;s paid.
        </p>
      ) : null}

      {waiting || expired ? null : sending && !isBusy ? (
        <Button
          size="lg"
          variant="outline"
          className="w-full"
          onClick={() => retryPayout(entitlement)}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry payout
        </Button>
      ) : payoutFailed ? (
        <Button
          size="lg"
          className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
          onClick={() => retryPayout(entitlement)}
          disabled={isBusy}
        >
          {isBusy ? (
            <>
              <Spinner className="mr-2 h-4 w-4" />
              Sending your USDC…
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </>
          )}
        </Button>
      ) : (
        <Button
          size="lg"
          className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
          onClick={() => wallet && claim(entitlement, wallet)}
          disabled={!canClaim || isBusy}
        >
          {isBusy ? (
            <>
              <Spinner className="mr-2 h-4 w-4" />
              {primaryLabel}
            </>
          ) : (
            <>
              <Wallet className="mr-2 h-4 w-4" />
              {primaryLabel}
            </>
          )}
        </Button>
      )}

      {!walletsLoading && !wallet ? (
        <p className="text-xs text-muted-foreground">Add a wallet to receive your USDC.</p>
      ) : null}
      {!configured ? (
        <p className="text-xs text-muted-foreground">
          Claiming is unavailable until this deployment is configured.
        </p>
      ) : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {waiting || expired ? null : (
        <>
          <p className="text-sm text-muted-foreground">
            You&apos;ll sign a free message confirming your wallet. No gas, no fees.
          </p>

          <NomineDetails>
            <NomineFactRow
              label="Campaign"
              value={<MonoValue value={entitlement.campaignId} label="Campaign id" />}
            />
            <NomineFactRow
              label="Wallet"
              value={<MonoValue value={wallet?.address} label="Wallet" />}
            />
            <NomineFactRow label="Deadline" value={formatTimestampWithTimezone(deadline)} />
            <NomineFactRow
              label="Contract"
              value={
                <MonoValue
                  value={entitlement.campaign?.contractAddress}
                  label="Contract address"
                />
              }
            />
            <NomineFactRow
              label="Approval"
              value={
                entitlement.campaign?.approvalMode === "auto"
                  ? "Automatic"
                  : entitlement.campaign?.approvalMode === "manual"
                  ? "Manual (issuer confirms)"
                  : "—"
              }
            />
            <div className="space-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
              <p>{ISSUER_CONFIRMATION_NOTICE}</p>
              <p>{WALLET_CHANGE_NOTICE}</p>
              <p>{D006_NOTICE}</p>
            </div>
          </NomineDetails>
        </>
      )}
    </div>
  );
}
