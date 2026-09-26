/**
 * StudioCampaign - issuer detail for a single campaign.
 *
 * Monitor funded / settled / remaining / reclaimed + approval requests + receipts with explorer
 * links. Approve a request by connecting the external approval wallet and signing the exact
 * `Approval` (amount, chain, contract and deadline are shown first; nothing is auto-approved).
 * Recover after expiry.
 */

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ExternalLink,
  KeyRound,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
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
import { useAccount } from "wagmi";
import { rosterEmailFor } from "@/lib/issuerRoster";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
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
  D006_NOTICE,
  EVIDENCE_NOTICE,
  ISSUER_KEY_NOTICE,
  NomineAuthorityRow,
  NomineDisclosure,
  NomineFactRow,
  NomineReceiptPanel,
  NomineStatusBadge,
  RECOVERY_RULE,
  WALLET_CHANGE_NOTICE,
} from "@/components/nomine";
import type { IssuerApprovalRequest, NomineCampaign, SigningWallet } from "@/types/nomine";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg">{value}</div>
    </Card>
  );
}

export default function StudioCampaign() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { address } = useAccount();

  const { campaign, requests, isLoading, error, refresh } =
    useNomineCampaignDetail(campaignId, { pollMs: 20000 });
  const { signApproval, isSigning } = useIssuerApproval();
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
          <p className="text-sm text-muted-foreground">
            {error || "Campaign not found."}
          </p>
        </div>
      </MainLayout>
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const accounting = campaign.accounting;
  const reclaimable = BigInt(accounting?.reclaimable ?? "0");
  const canRecover =
    campaign.status === "FUNDED" && reclaimable > 0n && now >= campaign.expiryTime;

  const isApprover =
    !!address &&
    address.toLowerCase() === campaign.issuerApproverAddress.toLowerCase();

  const settled = requests.filter((r) => r.status === "SETTLED");

  const handleRecover = async () => {
    const wallet: SigningWallet = { address: address as `0x${string}`, walletType: "external" };
    if (!address) {
      toast({ title: "Connect the issuer wallet", description: "Recovery must come from the funding wallet", variant: "destructive" });
      return;
    }
    try {
      await recover(campaign as NomineCampaign, wallet);
      toast({ title: "Funds recovered", description: "CampaignReclaimed confirmed" });
      refresh();
    } catch (err: unknown) {
      toast({
        title: "Recovery failed",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleSignApproval = async () => {
    if (!approving) return;
    try {
      await signApproval(campaign as NomineCampaign, approving);
      toast({ title: "Approval submitted", description: "Request advanced to ISSUER_APPROVED" });
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

  let config: { address: string; chainId: number } | null = null;
  if (isClaimCoreConfigured()) {
    const cfg = getClaimCoreConfig();
    config = { address: cfg.address, chainId: cfg.chainId };
  }

  return (
    <MainLayout>
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Button variant="ghost" className="mb-6" onClick={() => navigate("/studio")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Studio
        </Button>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold">Campaign</h1>
            <p className="mt-1 font-mono text-sm text-muted-foreground">{campaign.id}</p>
          </div>
          <div className="flex items-center gap-3">
            <NomineStatusBadge kind="campaign" value={campaign.status} />
            <Button variant="outline" size="sm" onClick={() => refresh()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Metrics */}
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Funded (budget)" value={formatUsdcDisplay(accounting?.budget ?? campaign.allocation)} />
          <Metric label="Settled" value={formatUsdcDisplay(accounting?.settled ?? "0")} />
          <Metric
            label="Remaining unsettled"
            value={formatUsdcDisplay(accounting?.remainingUnsettled ?? "0")}
          />
          <Metric label="Reclaimable" value={formatUsdcDisplay(accounting?.reclaimable ?? "0")} />
        </div>

        {/* Terms */}
        <Card className="mb-6 border border-border bg-card p-6">
          <h2 className="mb-4 font-display text-lg font-semibold">Immutable terms</h2>
          <div className="space-y-2">
            <NomineFactRow label="Recipients" value={campaign.entitlementCount} />
            <NomineFactRow label="Allocation per recipient" value={formatUsdcDisplay(campaign.allocation)} mono />
            <NomineFactRow label="Opens" value={formatTimestampWithTimezone(campaign.openingTime)} />
            <NomineFactRow label="Expires" value={formatTimestampWithTimezone(campaign.expiryTime)} />
            <NomineFactRow label="Chain" value={campaign.chainId} />
            <NomineFactRow label="Contract" value={campaign.contractAddress} mono />
          </div>

          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <NomineAuthorityRow
              role="Issuer approver (external, distinct)"
              address={campaign.issuerApproverAddress}
              note="Signs each Approval"
            />
            <NomineAuthorityRow role="Resolver (Nomine)" address={campaign.resolverAddress} note="Attaches attestation" />
          </div>

          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            {campaign.fundingTxHash ? (
              <a
                href={explorerTxUrl(campaign.fundingTxHash) ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                Funding tx <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
            {campaign.reclaimedTxHash ? (
              <a
                href={explorerTxUrl(campaign.reclaimedTxHash) ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                Reclaim tx <ExternalLink className="h-3 w-3" />
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
        </Card>

        {/* Approval requests */}
        <h2 className="mb-3 font-display text-lg font-semibold">Approval requests</h2>
        {requests.length === 0 ? (
          <p className="mb-6 text-sm text-muted-foreground">No approval requests yet.</p>
        ) : (
          <div className="mb-6 space-y-3">
            {requests.map((request) => (
              <Card key={request.id} className="border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1 text-sm">
                    <div className="font-mono">{request.walletAddress}</div>
                    <div className="text-muted-foreground">
                      {rosterEmailFor(campaign.id, request.entitlementId) ?? (
                        <span className="italic">
                          no local record — check your exported mapping before approving
                        </span>
                      )}
                    </div>
                    <div className="text-muted-foreground">
                      {formatUsdcDisplay(request.amount)} · deadline{" "}
                      {formatTimestampWithTimezone(request.deadline)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <NomineStatusBadge kind="request" value={request.status} />
                    {request.status === "CONSENTED" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setApproving(request)}
                        disabled={!isApprover}
                      >
                        <KeyRound className="mr-2 h-4 w-4" />
                        Review &amp; approve
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Receipts */}
        <h2 className="mb-3 font-display text-lg font-semibold">Receipts</h2>
        {settled.length === 0 ? (
          <p className="mb-6 text-sm text-muted-foreground">No settlements yet.</p>
        ) : (
          <div className="mb-6 space-y-3">
            {settled.map((request) => (
              <NomineReceiptPanel key={request.id} receipt={request.receipt ?? null} />
            ))}
          </div>
        )}

        {/* Recovery */}
        <Card className="mb-8 border border-border bg-card p-6">
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
                Recover unclaimed funds
              </>
            )}
          </Button>
          {!canRecover ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Recovery is available after expiry once there are unclaimed funds. Recovery needs no
              approver.
            </p>
          ) : null}
        </Card>

        <div className="space-y-3">
          <NomineDisclosure title="Issuer key">{ISSUER_KEY_NOTICE}</NomineDisclosure>
          <NomineDisclosure title="Evidence">{EVIDENCE_NOTICE}</NomineDisclosure>
          <NomineDisclosure tone="warning" title="No revocation">
            {WALLET_CHANGE_NOTICE}
          </NomineDisclosure>
          <NomineDisclosure tone="warning" title="Two-authority risk">{D006_NOTICE}</NomineDisclosure>
        </div>
      </div>

      {/* Approval dialog - shows the exact Approval before signing; never auto-approves. */}
      <Dialog open={!!approving} onOpenChange={(open) => !open && setApproving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-2xl">Sign approval</DialogTitle>
            <DialogDescription>
              Review the exact Approval. Nothing is auto-approved.
            </DialogDescription>
          </DialogHeader>

          {approving ? (
            <div className="space-y-3">
              <div className="space-y-2 rounded-lg border border-border bg-surface/50 p-4">
                <NomineFactRow label="Amount" value={formatUsdcDisplay(approving.amount)} mono />
                <NomineFactRow label="Chain" value={config?.chainId ?? campaign.chainId} />
                <NomineFactRow label="Contract" value={config?.address ?? campaign.contractAddress} mono />
                <NomineFactRow label="Payout wallet" value={approving.walletAddress} mono />
                <NomineFactRow
                  label="Deadline"
                  value={formatTimestampWithTimezone(approving.deadline)}
                />
                <NomineFactRow label="Consent digest" value={approving.consentDigest} mono />
              </div>

              <NomineDisclosure tone={isApprover ? "info" : "warning"} title="Approval wallet">
                {isApprover
                  ? "Connected wallet matches this campaign's issuer-approval address."
                  : "Connect the distinct external issuer-approval wallet to sign. The connected wallet does not match."}
              </NomineDisclosure>

              <div className="flex gap-2">
                <Button
                  className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
                  onClick={handleSignApproval}
                  disabled={!isApprover || isSigning}
                >
                  {isSigning ? (
                    <>
                      <Spinner className="mr-2 h-4 w-4" />
                      Signing…
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      Sign approval
                    </>
                  )}
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => setApproving(null)}>
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
