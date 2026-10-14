/**
 * Inbox - claimant surface.
 *
 * Sign in and see only your own entitlements. Choose a wallet and sign consent, landing on
 * "Awaiting issuer confirmation". Distinguish awaiting-issuer from awaiting-Resolver/submission,
 * trigger/refresh the sponsored settlement, and show pending and recoverable failure honestly.
 * A receipt is only shown on a verified `Settlement`.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Clock,
  Gift,
  Inbox as InboxIcon,
  RefreshCw,
  Send,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { MainLayout } from "@/components/MainLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FullPageLoader, Spinner } from "@/components/Loader";
import { WalletSelector } from "@/components/WalletSelector";
import { TestnetPill } from "@/components/TestnetPill";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useClaimConsent } from "@/hooks/useClaimConsent";
import { useNomineInbox, useSettleClaim } from "@/hooks/useNomineInbox";
import {
  formatTimestampWithTimezone,
  formatUsdcDisplay,
  isClaimCoreConfigured,
} from "@/lib/claimCore";
import {
  DIRECT_PAYOUT_NOTICE,
  D006_NOTICE,
  ELIGIBILITY_NOTICE,
  ISSUER_CONFIRMATION_NOTICE,
  NomineAuthorityRow,
  NomineChip,
  NomineDisclosure,
  NomineFactRow,
  NomineReceiptPanel,
  NomineStatusBadge,
  RECOVERY_RULE,
  WALLET_CHANGE_NOTICE,
} from "@/components/nomine";
import type { NomineEntitlement, SigningWallet } from "@/types/nomine";

const ACTIVE_REQUEST_STATUSES = ["CONSENTED", "ISSUER_APPROVED", "SUBMITTED"];

function hasActiveRequest(entitlement: NomineEntitlement): boolean {
  const status = entitlement.request?.status;
  return !!status && ACTIVE_REQUEST_STATUSES.includes(status);
}

function EntitlementCard({
  entitlement,
  onSign,
  onSettle,
  isSettling,
}: {
  entitlement: NomineEntitlement;
  onSign: (entitlement: NomineEntitlement) => void;
  onSettle: (entitlement: NomineEntitlement) => void;
  isSettling: boolean;
}) {
  const campaign = entitlement.campaign;
  const now = Math.floor(Date.now() / 1000);
  const opensAt = entitlement.opensAt ?? campaign?.openingTime ?? 0;
  const preOpening = opensAt > now;
  const request = entitlement.request;
  const active = hasActiveRequest(entitlement);

  return (
    <Card className="border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-medium">
            <span>
              {campaign?.issuerName || "Campaign"} · {formatUsdcDisplay(entitlement.amount)}
            </span>
            <TestnetPill label="Test USDC · Arc Testnet" />
          </div>
          <div className="text-xs text-muted-foreground">
            From <span className="font-mono">{campaign?.issuer}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {preOpening ? (
            <NomineChip className="border-accent/40 text-accent">
              <Clock className="h-3 w-3" /> Opens {formatTimestampWithTimezone(opensAt)}
            </NomineChip>
          ) : null}
          {request ? (
            <NomineStatusBadge
              kind={entitlement.status === "COMPLETED" ? "lifecycle" : "workflow"}
              value={
                entitlement.status === "COMPLETED"
                  ? "COMPLETED"
                  : request.status === "CONSENTED"
                  ? "AWAITING_ISSUER"
                  : request.status === "ISSUER_APPROVED"
                  ? "AWAITING_RESOLVER"
                  : request.status === "SUBMITTED"
                  ? "PENDING_SUBMISSION"
                  : request.status
              }
            />
          ) : (
            <NomineStatusBadge kind="lifecycle" value={entitlement.status} />
          )}
        </div>
      </div>

      <div className="mb-3 space-y-1.5">
        <NomineFactRow label="Allocation" value={formatUsdcDisplay(entitlement.amount)} mono />
        <NomineFactRow label="Opens" value={formatTimestampWithTimezone(opensAt)} />
        <NomineFactRow label="Expires" value={formatTimestampWithTimezone(campaign?.expiryTime)} />
        <NomineFactRow label="Chain" value={campaign?.chainId} />
        <NomineFactRow label="Contract" value={campaign?.contractAddress} mono />
        <NomineAuthorityRow role="Issuer approver" address={campaign?.issuerApproverAddress} />
        <NomineAuthorityRow role="Resolver (Nomine)" address={campaign?.resolverAddress} />
        <NomineFactRow
          label="Funding"
          value={
            campaign?.funded ? (
              <span className="text-success">Verifiably funded</span>
            ) : (
              <span className="text-muted-foreground">Not funded</span>
            )
          }
        />
      </div>

      {/* Actions */}
      {entitlement.status === "COMPLETED" ? (
        <NomineReceiptPanel receipt={request?.receipt ?? null} />
      ) : entitlement.status === "EXPIRED" ? (
        <p className="text-sm text-muted-foreground">
          This entitlement was not settled before expiry. Unclaimed funds return to the issuer.
        </p>
      ) : preOpening ? (
        <p className="text-sm text-muted-foreground">
          Claiming is disabled until this campaign opens.
        </p>
      ) : active ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {request?.status === "CONSENTED"
              ? "Awaiting issuer confirmation. Nothing settles until the issuer approves your consent."
              : request?.status === "ISSUER_APPROVED"
              ? "Issuer approved. Awaiting Resolver attestation / submission."
              : "Pending submission. This request has not been confirmed on-chain yet."}
          </p>
          {request?.status === "CONSENTED" ? (
            <p className="text-sm text-muted-foreground">
              Your request stays valid until{" "}
              {formatTimestampWithTimezone(request.deadline)}. The issuer confirms
              your wallet within that time.
            </p>
          ) : null}
          {request?.status === "ISSUER_APPROVED" || request?.status === "SUBMITTED" ? (
            <Button
              size="sm"
              className="bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={() => onSettle(entitlement)}
              disabled={isSettling}
            >
              {isSettling ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Settling…
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Trigger sponsored settlement
                </>
              )}
            </Button>
          ) : null}
        </div>
      ) : request?.status === "FAILED" ? (
        <div className="space-y-3">
          <NomineDisclosure tone="warning" title="Recoverable failure">
            {request.failureReason ||
              "The last attempt did not complete. No entitlement was consumed. You can retry."}
          </NomineDisclosure>
          <Button
            size="sm"
            className="bg-accent text-accent-foreground hover:bg-accent/90"
            onClick={() => onSettle(entitlement)}
            disabled={isSettling}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry settlement
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          className="bg-accent text-accent-foreground hover:bg-accent/90"
          onClick={() => onSign(entitlement)}
        >
          <Wallet className="mr-2 h-4 w-4" />
          Choose wallet &amp; sign consent
        </Button>
      )}

      <div className="mt-4 space-y-2">
        <NomineDisclosure title="Eligibility source">{ELIGIBILITY_NOTICE}</NomineDisclosure>
        <NomineDisclosure title="Direct payout">{DIRECT_PAYOUT_NOTICE}</NomineDisclosure>
        <NomineDisclosure title="Fixed recovery rule">{RECOVERY_RULE}</NomineDisclosure>
        <NomineDisclosure title="Issuer confirmation required">{ISSUER_CONFIRMATION_NOTICE}</NomineDisclosure>
        <NomineDisclosure tone="warning" title="Wallet change / re-signing">{WALLET_CHANGE_NOTICE}</NomineDisclosure>
        <NomineDisclosure tone="warning" title="Two-authority risk">{D006_NOTICE}</NomineDisclosure>
      </div>
    </Card>
  );
}

export default function Inbox() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { grouping, isLoading, error, refresh } = useNomineInbox({ pollMs: 30000 });
  const { signConsent, buildTypedData, isSigning } = useClaimConsent();
  const { settle, step: settleStep } = useSettleClaim();
  /** Only these two steps are in flight; "settled" and "failed" are terminal. */
  const isSettling =
    settleStep === "submitting" || settleStep === "awaiting_confirmation";

  const {
    wallets: walletBalances,
    isLoading: isBalanceLoading,
  } = useWalletBalances();

  const [consentTarget, setConsentTarget] = useState<NomineEntitlement | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<string | undefined>();
  const [settlingId, setSettlingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      navigate("/app?next=/inbox");
    }
  }, [isAuthLoading, isAuthenticated, navigate]);

  type WalletBalance = (typeof walletBalances)[number];

  useEffect(() => {
    if (!selectedWallet && walletBalances.length > 0) {
      const first = walletBalances.find((w: WalletBalance) => w.isEnabled);
      if (first) setSelectedWallet(first.address);
    }
  }, [walletBalances, selectedWallet]);

  const selectedWalletData = walletBalances.find(
    (w: WalletBalance) => w.address === selectedWallet
  );

  const signingWallet: SigningWallet | null = useMemo(() => {
    if (!selectedWallet || !selectedWalletData) return null;
    return {
      address: selectedWallet as `0x${string}`,
      walletType: selectedWalletData.walletType === "privy" ? "privy" : "external",
    };
  }, [selectedWallet, selectedWalletData]);

  const consentPreview = useMemo(() => {
    if (!consentTarget || !signingWallet) return null;
    try {
      return buildTypedData({
        campaign: consentTarget.campaign,
        entitlementId: consentTarget.entitlementId,
        wallet: signingWallet,
        amount: consentTarget.amount,
      });
    } catch {
      return null;
    }
  }, [consentTarget, signingWallet, buildTypedData]);

  const handleSignConsent = async () => {
    if (!consentTarget || !signingWallet) {
      toast({ title: "Wallet required", description: "Choose a payout wallet", variant: "destructive" });
      return;
    }
    try {
      await signConsent({
        campaign: consentTarget.campaign,
        entitlementId: consentTarget.entitlementId,
        wallet: signingWallet,
        amount: consentTarget.amount,
      });
      toast({
        title: "Awaiting issuer confirmation",
        description: "The issuer must approve your consent before anything settles.",
      });
      setConsentTarget(null);
      refresh();
    } catch (err: unknown) {
      toast({
        title: "Signing failed",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleSettle = async (entitlement: NomineEntitlement) => {
    if (!entitlement.request) return;
    setSettlingId(entitlement.entitlementId);
    try {
      const result = await settle(entitlement.campaignId, entitlement.request.id);
      if (result?.status === "SETTLED") {
        toast({ title: "Settled", description: "A verified Settlement event consumed your entitlement" });
      } else {
        toast({
          title: "Still pending",
          description: "The sponsored submission has not confirmed yet. You can retry.",
        });
      }
      refresh();
    } catch (err: unknown) {
      toast({
        title: "Settlement failed",
        description: err instanceof Error ? err.message : "No entitlement was consumed. You can retry.",
        variant: "destructive",
      });
      refresh();
    } finally {
      setSettlingId(null);
    }
  };

  if (isAuthLoading) return <FullPageLoader />;

  const configured = isClaimCoreConfigured();

  return (
    <MainLayout>
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold">Inbox</h1>
            <p className="mt-1 text-muted-foreground">Your own entitlements only</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refresh()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {!configured ? (
          <NomineDisclosure tone="warning" title="Claim Core not configured" className="mb-6">
            VITE_CLAIM_CORE_ADDRESS is not set. Nomine fails closed and will not sign consent until
            the Claim Core address and chain are configured.
          </NomineDisclosure>
        ) : null}

        {error ? (
          <NomineDisclosure tone="warning" className="mb-6" title="Could not load inbox">
            {error}
          </NomineDisclosure>
        ) : null}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4 text-accent" /> Loading your entitlements…
          </div>
        ) : (
          <>
            <section className="mb-8">
              <div className="mb-3 flex items-center gap-2">
                <Gift className="h-5 w-5 text-accent" />
                <h2 className="font-display text-xl font-semibold">Available</h2>
                <span className="text-sm text-muted-foreground">
                  ({grouping.available.length})
                </span>
              </div>
              {grouping.available.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing available right now.</p>
              ) : (
                <div className="space-y-4">
                  {grouping.available.map((entitlement) => (
                    <EntitlementCard
                      key={entitlement.entitlementId}
                      entitlement={entitlement}
                      onSign={setConsentTarget}
                      onSettle={handleSettle}
                      isSettling={isSettling && settlingId === entitlement.entitlementId}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="mb-8">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-success" />
                <h2 className="font-display text-xl font-semibold">Completed</h2>
                <span className="text-sm text-muted-foreground">
                  ({grouping.completed.length})
                </span>
              </div>
              {grouping.completed.length === 0 ? (
                <p className="text-sm text-muted-foreground">No completed claims yet.</p>
              ) : (
                <div className="space-y-4">
                  {grouping.completed.map((entitlement) => (
                    <EntitlementCard
                      key={entitlement.entitlementId}
                      entitlement={entitlement}
                      onSign={setConsentTarget}
                      onSettle={handleSettle}
                      isSettling={false}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="mb-8">
              <div className="mb-3 flex items-center gap-2">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <h2 className="font-display text-xl font-semibold">Expired</h2>
                <span className="text-sm text-muted-foreground">
                  ({grouping.expired.length})
                </span>
              </div>
              {grouping.expired.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing has expired.</p>
              ) : (
                <div className="space-y-4">
                  {grouping.expired.map((entitlement) => (
                    <EntitlementCard
                      key={entitlement.entitlementId}
                      entitlement={entitlement}
                      onSign={setConsentTarget}
                      onSettle={handleSettle}
                      isSettling={false}
                    />
                  ))}
                </div>
              )}
            </section>

            {grouping.available.length === 0 &&
            grouping.completed.length === 0 &&
            grouping.expired.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <InboxIcon className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No entitlements yet. When an issuer funds a campaign with your verified email, it
                  appears here.
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Consent dialog - shows the exact ClaimRequest before signing. */}
      <Dialog open={!!consentTarget} onOpenChange={(open) => !open && setConsentTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-2xl">Sign consent</DialogTitle>
            <DialogDescription>
              You sign the ClaimRequest with the payout wallet you choose. This is the only
              signature that chooses the destination.
            </DialogDescription>
          </DialogHeader>

          {consentTarget ? (
            <div className="space-y-4">
              <WalletSelector
                wallets={walletBalances}
                selectedWallet={selectedWallet}
                onSelectWallet={setSelectedWallet}
                isLoading={isBalanceLoading}
              />

              <div className="space-y-2 rounded-lg border border-border bg-surface/50 p-4">
                <NomineFactRow label="Amount" value={formatUsdcDisplay(consentTarget.amount)} mono />
                <NomineFactRow label="Chain" value={consentTarget.campaign?.chainId} />
                <NomineFactRow label="Contract" value={consentTarget.campaign?.contractAddress} mono />
                <NomineFactRow
                  label="Deadline"
                  value={
                    consentPreview ? formatTimestampWithTimezone(consentPreview.deadline) : "—"
                  }
                />
                <NomineFactRow label="Payout wallet" value={signingWallet?.address ?? "—"} mono />
              </div>

              <p className="text-sm text-muted-foreground">
                Your request stays valid until{" "}
                {consentPreview
                  ? formatTimestampWithTimezone(consentPreview.deadline)
                  : "—"}
                . The issuer confirms your wallet within that time.
              </p>

              <NomineDisclosure tone="warning" title="No revocation">
                {WALLET_CHANGE_NOTICE}
              </NomineDisclosure>
              <NomineDisclosure title="Issuer confirmation required">
                {ISSUER_CONFIRMATION_NOTICE}
              </NomineDisclosure>

              <div className="flex gap-2">
                <Button
                  className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
                  onClick={handleSignConsent}
                  disabled={!signingWallet || isSigning || !configured}
                >
                  {isSigning ? (
                    <>
                      <Spinner className="mr-2 h-4 w-4" />
                      Signing…
                    </>
                  ) : (
                    <>
                      <Wallet className="mr-2 h-4 w-4" />
                      Sign &amp; submit
                    </>
                  )}
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => setConsentTarget(null)}>
                  Cancel
                </Button>
              </div>

              {settleStep === "failed" ? (
                <p className="text-xs text-muted-foreground">
                  No entitlement is consumed by a failed submission; you can retry.
                </p>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
