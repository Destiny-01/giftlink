/**
 * StudioCampaign - issuer detail for a single campaign.
 *
 * Header: status, progress and the claim link to share. Then one row per recipient with their
 * state and payout transaction. In manual mode the issuer approves a payout here and the payout is
 * sent straight after the signature; in automatic mode there is nothing to approve. Recovery is
 * offered once the window has closed.
 *
 * The technical facts (contract, resolver, approver, hashes) live in a collapsed Details disclosure.
 */

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { MainLayout } from "@/components/MainLayout";
import { TestnetPill } from "@/components/TestnetPill";
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
import { useAccount } from "wagmi";
import { loadRoster, rosterEmailFor } from "@/lib/issuerRoster";
import { maskEmail, truncateMono } from "@/lib/mono";
import { buildRecipientRows, claimedCount } from "@/lib/campaignRecipients";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useClipboard } from "@/hooks/useClipboard";
import {
  useIssuerApproval,
  useNomineCampaignDetail,
  useRecoverNomineCampaign,
} from "@/hooks/useNomineCampaign";
import {
  explorerAddressUrl,
  explorerTxUrl,
  formatTimestampWithTimezone,
  formatUsdcDisplay,
  getClaimCoreConfig,
  isClaimCoreConfigured,
} from "@/lib/claimCore";
import {
  CampaignProgress,
  D006_NOTICE,
  EVIDENCE_NOTICE,
  MonoValue,
  NomineAuthorityRow,
  NomineDetails,
  NomineDisclosure,
  NomineFactRow,
  NomineStatusBadge,
  RECOVERY_RULE,
  WALLET_CHANGE_NOTICE,
} from "@/components/nomine";
import type {
  ClaimRequestView,
  IssuerApprovalRequest,
  NomineCampaign,
  SigningWallet,
} from "@/types/nomine";

/**
 * What a relay result actually means. Kept in one place so neither action can overstate it: the
 * relay is asynchronous, so anything other than a settled request is "still being sent".
 */
function payoutToast(
  result: { settlement: ClaimRequestView | null; settleError: string | null },
  titles: { settled: string; pending: string }
): { title: string; description: string; variant?: "destructive" } {
  if (result.settleError) {
    return { title: titles.pending, description: result.settleError, variant: "destructive" };
  }
  if (result.settlement?.status === "SETTLED") {
    return {
      title: titles.settled,
      description: result.settlement.settlementTxHash
        ? `Transaction ${truncateMono(result.settlement.settlementTxHash)}`
        : "The wallet has been paid",
    };
  }
  return { title: titles.pending, description: "The payout is still being relayed." };
}

export default function StudioCampaign() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { isLoading: isAuthLoading, connectWallet } = useAuth();
  const { address } = useAccount();
  const { copyToClipboard } = useClipboard();

  const { campaign, requests, isLoading, error, refresh } =
    useNomineCampaignDetail(campaignId, { pollMs: 20000 });
  const { approveRequest, sendApprovedPayout, isSigning, isSettling } = useIssuerApproval();
  const { recover, isRecovering } = useRecoverNomineCampaign();

  const [approving, setApproving] = useState<IssuerApprovalRequest | null>(null);

  if (isAuthLoading || (isLoading && !campaign)) return <FullPageLoader />;

  if (error || !campaign) {
    return (
      <MainLayout>
        <div className="container mx-auto max-w-4xl px-4 py-8">
          <Button variant="ghost" className="mb-6" onClick={() => navigate("/studio")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Studio
          </Button>
          <p className="text-sm text-muted-foreground">{error || "Campaign not found."}</p>
        </div>
      </MainLayout>
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const accounting = campaign.accounting;
  const reclaimable = BigInt(accounting?.reclaimable ?? "0");
  const expired = now >= campaign.expiryTime;
  /**
   * Only an explicit `"auto"` is automatic. A `"manual"` campaign and one whose response predates
   * the field both need the issuer to approve - defaulting the other way would leave recipients
   * waiting forever behind a page that says nothing is needed.
   */
  const manual = campaign.approvalMode !== "auto";
  const canRecover =
    campaign.status === "FUNDED" && reclaimable > 0n && expired;

  const claimed = claimedCount(campaign, requests);
  const rows = buildRecipientRows(loadRoster(campaign.id), requests, {
    campaignExpired: expired,
  });

  const isApprover =
    !!address && address.toLowerCase() === campaign.issuerApproverAddress.toLowerCase();

  const claimLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/campaign/${campaign.id}`
      : "";

  let config: { address: string; chainId: number } | null = null;
  if (isClaimCoreConfigured()) {
    const cfg = getClaimCoreConfig();
    config = { address: cfg.address, chainId: cfg.chainId };
  }

  const handleRecover = async () => {
    if (!address) {
      toast({ title: "Connect the funding wallet", description: "Recovery comes from the wallet that funded this campaign", variant: "destructive" });
      return;
    }
    const wallet: SigningWallet = { address: address as `0x${string}`, walletType: "external" };
    try {
      await recover(campaign as NomineCampaign, wallet);
      toast({ title: "Funds recovered", description: "The reclaim transaction is confirmed" });
      refresh();
    } catch (err: unknown) {
      toast({
        title: "Recovery failed",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleSendPayout = async (request: IssuerApprovalRequest) => {
    const result = await sendApprovedPayout(campaign.id, request.id);
    toast(payoutToast(result, { settled: "Payout sent", pending: "Not settled yet" }));
    refresh();
  };

  const handleApprove = async () => {
    if (!approving) return;
    try {
      // Approval plus settlement: the payout is relayed straight after the signature, so the
      // issuer never has to come back for the same payout.
      const result = await approveRequest(campaign as NomineCampaign, approving);
      toast(
        payoutToast(result, { settled: "Payout sent", pending: "Approved, not settled yet" })
      );
      setApproving(null);
      refresh();
    } catch (err: unknown) {
      toast({
        title: "Approval failed",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  return (
    <MainLayout>
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Button variant="ghost" className="mb-6" onClick={() => navigate("/studio")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Studio
        </Button>

        <div className="mb-6 min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-3xl font-bold">
                {campaign.name || "Campaign"}
              </h1>
              <p className="mt-1 text-muted-foreground">
                {campaign.entitlementCount} recipients ·{" "}
                {formatUsdcDisplay(campaign.allocation)} each
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <TestnetPill label="Test USDC · Arc Testnet" />
              <NomineStatusBadge kind="campaign" value={campaign.status} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(claimLink, "Claim link copied")}
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy claim link
              </Button>
              <Button variant="outline" size="sm" onClick={() => refresh()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>
          </div>

          <CampaignProgress
            claimed={claimed}
            total={campaign.entitlementCount}
            settled={accounting?.settled ?? "0"}
            budget={accounting?.budget ?? "0"}
          />
        </div>

        {/* Approval state, right where the approve buttons are. */}
        {manual ? (
          <div className="mb-6 space-y-3">
            {!isApprover ? (
              <NomineDisclosure tone="warning" title="Approval wallet">
                <p className="min-w-0 break-words">
                  Switch your wallet to{" "}
                  <span className="font-mono">
                    {truncateMono(campaign.issuerApproverAddress)}
                  </span>{" "}
                  to approve. You&apos;re connected as{" "}
                  <span className="font-mono">{address ? truncateMono(address) : "no wallet"}</span>.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={connectWallet}
                >
                  Connect or switch wallet
                </Button>
              </NomineDisclosure>
            ) : null}
            <p className="text-sm text-muted-foreground">
              You approve each payout here; the payout is sent automatically as soon as you sign.
            </p>
          </div>
        ) : (
          <div className="mb-6">
            <NomineDisclosure title="Automatic approval">
              Payouts are approved automatically when recipients claim.
            </NomineDisclosure>
          </div>
        )}

        {/* Recipients: one row per recipient, never a wide table (375px must not scroll) */}
        <Card className="mb-6 min-w-0 border border-border bg-card p-6">
          <h2 className="mb-3 font-display text-lg font-semibold">Recipients</h2>

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recipients recorded in this browser. Download your recipient mapping from Studio to
              check wallets before approving.
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((row) => {
                const request = row.request;
                const approvable = manual && request?.status === "CONSENTED";
                // An approved payout that has not settled still needs sending - that is the retry
                // after a failed attempt, and it is idempotent server-side. FAILED belongs here
                // too: the relay failed, nothing was consumed, and the same call retries it.
                const resendable =
                  manual &&
                  (request?.status === "ISSUER_APPROVED" ||
                    request?.status === "SUBMITTED" ||
                    request?.status === "FAILED");
                const txUrl = explorerTxUrl(row.settlementTxHash);
                return (
                  <li
                    key={row.entitlementId}
                    className="min-w-0 rounded-lg border border-border bg-surface/40 p-3"
                  >
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <div className="min-w-0 space-y-0.5">
                        <div className="truncate text-sm font-medium">
                          {row.email ? maskEmail(row.email) : "No local record"}
                        </div>
                        {row.walletAddress ? (
                          <MonoValue
                            value={row.walletAddress}
                            label="Wallet"
                            className="text-xs text-muted-foreground"
                          />
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <NomineStatusBadge kind="recipient" value={row.status} />
                        {txUrl ? (
                          <a
                            href={txUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                          >
                            Payout
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                        {approvable && request ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setApproving(request)}
                            disabled={!isApprover}
                          >
                            <KeyRound className="mr-2 h-4 w-4" />
                            Approve payout
                          </Button>
                        ) : null}
                        {resendable && request ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSendPayout(request)}
                            disabled={isSettling}
                          >
                            <Send className="mr-2 h-4 w-4" />
                            Send payout
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Recovery */}
        <Card className="mb-6 min-w-0 border border-border bg-card p-6">
          <h2 className="mb-2 font-display text-lg font-semibold">Recovery</h2>
          <p className="mb-4 text-sm text-muted-foreground">{RECOVERY_RULE}</p>
          <Button
            variant="outline"
            onClick={handleRecover}
            disabled={!canRecover || isRecovering || campaign.status !== "FUNDED"}
          >
            {isRecovering ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                Recovering…
              </>
            ) : (
              <>
                <RotateCcw className="mr-2 h-4 w-4" />
                Recover unclaimed {formatUsdcDisplay(reclaimable)}
              </>
            )}
          </Button>
          {!canRecover ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {campaign.status === "RECLAIMED" || reclaimable === 0n
                ? "Nothing is left to recover."
                : `Available after ${formatTimestampWithTimezone(campaign.expiryTime)}.`}
            </p>
          ) : null}
        </Card>

        {/* Technical facts */}
        <NomineDetails label="Campaign details">
          <NomineFactRow label="Contract" value={config?.address ?? ""} mono />
          <NomineFactRow label="Chain" value={config?.chainId ?? campaign.chainId} />
          <NomineAuthorityRow
            role="Payout approver"
            address={campaign.issuerApproverAddress}
            note={manual ? "Signs each payout" : "Approves automatically"}
          />
          <NomineAuthorityRow
            role="Resolver (Nomine)"
            address={campaign.resolverAddress}
            note="Attaches the settlement attestation"
          />
          <NomineFactRow
            label="Funding"
            value={formatUsdcDisplay(accounting?.budget ?? campaign.allocation)}
            mono
          />
          <NomineFactRow
            label="Paid out"
            value={formatUsdcDisplay(accounting?.settled ?? "0")}
            mono
          />
          <NomineFactRow
            label="Recoverable"
            value={formatUsdcDisplay(accounting?.reclaimable ?? "0")}
            mono
          />
          <div className="flex flex-wrap gap-4 border-t border-border pt-3 text-sm">
            {campaign.fundingTxHash ? (
              <a
                href={explorerTxUrl(campaign.fundingTxHash) ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                Funding transaction <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
            {campaign.reclaimedTxHash ? (
              <a
                href={explorerTxUrl(campaign.reclaimedTxHash) ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                Reclaim transaction <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
            <a
              href={explorerAddressUrl(campaign.contractAddress) ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              Contract <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="space-y-2 border-t border-border pt-3">
            <NomineDisclosure title="Evidence">{EVIDENCE_NOTICE}</NomineDisclosure>
            <NomineDisclosure tone="warning" title="No revocation">
              {WALLET_CHANGE_NOTICE}
            </NomineDisclosure>
            <NomineDisclosure tone="warning" title="Two-authority risk">
              {D006_NOTICE}
            </NomineDisclosure>
          </div>
        </NomineDetails>
      </div>

      {/* Approval dialog: a short summary first, the exact facts one tap away. */}
      <Dialog
        open={!!approving}
        onOpenChange={(open) => {
          // ESC and the backdrop must not close the dialog out from under a signature in flight.
          if (!open && (isSigning || isSettling)) return;
          if (!open) setApproving(null);
        }}
      >
        <DialogContent className="min-w-0">
          <DialogHeader>
            <DialogTitle className="text-2xl">Sign approval</DialogTitle>
            <DialogDescription>
              This payout is sent to the wallet below as soon as you sign.
            </DialogDescription>
          </DialogHeader>

          {approving ? (
            <div className="min-w-0 space-y-3">
              <div className="min-w-0 space-y-2 rounded-lg border border-border bg-surface/50 p-4">
                <NomineFactRow
                  label="Recipient"
                  value={
                    maskEmail(rosterEmailFor(campaign.id, approving.entitlementId)) ||
                    "No local record — check your exported mapping"
                  }
                />
                <NomineFactRow label="Amount" value={formatUsdcDisplay(approving.amount)} mono />
                <NomineFactRow label="Wallet" value={approving.walletAddress} mono />
              </div>

              <NomineDetails>
                <NomineFactRow label="Chain" value={config?.chainId ?? campaign.chainId} />
                <NomineFactRow
                  label="Contract"
                  value={config?.address ?? campaign.contractAddress}
                  mono
                />
                <NomineFactRow
                  label="Deadline"
                  value={formatTimestampWithTimezone(approving.deadline)}
                />
                <NomineFactRow label="Consent digest" value={approving.consentDigest} mono />
              </NomineDetails>

              <NomineDisclosure tone={isApprover ? "info" : "warning"} title="Approval wallet">
                {isApprover
                  ? "This wallet matches the campaign's payout approver."
                  : "Connect the wallet this campaign approves payouts with. The connected wallet does not match."}
              </NomineDisclosure>

              <div className="flex gap-2">
                <Button
                  className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
                  onClick={handleApprove}
                  disabled={!isApprover || isSigning || isSettling}
                >
                  {isSigning ? (
                    <>
                      <Spinner className="mr-2 h-4 w-4" />
                      Signing…
                    </>
                  ) : isSettling ? (
                    <>
                      <Spinner className="mr-2 h-4 w-4" />
                      Sending the payout…
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Approve and send
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setApproving(null)}
                  disabled={isSigning || isSettling}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
