/**
 * CampaignLink - public link view.
 *
 * Signed out, it is a friendly hero: who sent what, and one button to sign in and claim. Signed in,
 * it renders the exact same `ClaimAction` as the Inbox - the claim logic is never duplicated.
 *
 * The technical facts (both Gate authorities, the funding transaction, the honesty notices) live in a
 * collapsed Details disclosure so the default view stays plain-language.
 */

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarClock,
  Coins,
  ExternalLink,
  ShieldCheck,
  Users,
} from "lucide-react";
import { MainLayout } from "@/components/MainLayout";
import { TestnetPill } from "@/components/TestnetPill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FullPageLoader, Spinner } from "@/components/Loader";
import * as api from "@/services/api";
import { useAuth } from "@/hooks/useAuth";
import { useNomineInbox } from "@/hooks/useNomineInbox";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { maskEmail } from "@/lib/mono";
import {
  explorerAddressUrl,
  explorerTxUrl,
  formatTimestampWithTimezone,
  formatUsdcDisplay,
} from "@/lib/claimCore";
import {
  ClaimAction,
  DIRECT_PAYOUT_NOTICE,
  D006_NOTICE,
  ELIGIBILITY_NOTICE,
  FUNDING_NOTICE,
  ISSUER_CONFIRMATION_NOTICE,
  MonoValue,
  NomineAuthorityRow,
  NomineDetails,
  NomineDisclosure,
  NomineFactRow,
  NomineStatusBadge,
  RECOVERY_RULE,
} from "@/components/nomine";
import type { CampaignPublicView, NomineEntitlement } from "@/types/nomine";

function SignInHero({
  issuer,
  amount,
  emailHint,
  onSignIn,
}: {
  issuer: string;
  amount: string;
  emailHint: string | null;
  onSignIn: () => void;
}) {
  return (
    <Card className="mb-6 min-w-0 border border-accent/30 bg-accent/5 p-6">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 font-display text-2xl font-bold">
        <span className="min-w-0 break-words">{issuer} sent you</span>
        <span className="text-accent">{amount}</span>
      </div>
      <p className="mb-4 text-muted-foreground">
        Sign in with {emailHint || "your email"} to claim.
      </p>
      <Button
        size="lg"
        className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
        onClick={onSignIn}
      >
        Sign in to claim
      </Button>
    </Card>
  );
}

export default function CampaignLink() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { wallets, isLoading: isBalanceLoading } = useWalletBalances();
  // Only the claimant needs their own entitlement, and only when signed in.
  const { grouping, isLoading: isInboxLoading, error: inboxError } = useNomineInbox({
    pollMs: 30000,
    enabled: isAuthenticated,
  });

  const [campaign, setCampaign] = useState<CampaignPublicView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!campaignId) return;
      setIsLoading(true);
      try {
        const data = await api.getNomineCampaignPublic(campaignId);
        if (!cancelled) setCampaign(data ?? null);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Campaign not found");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (isLoading) return <FullPageLoader />;

  const entitlement: NomineEntitlement | null =
    grouping.available
      .concat(grouping.completed, grouping.expired)
      .find((candidate) => candidate.campaignId === campaignId) ?? null;

  const issuer = campaign?.issuerName || "Someone";
  const nextPath = `/app?next=/campaign/${encodeURIComponent(campaignId ?? "")}`;

  return (
    <MainLayout>
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <Button variant="ghost" className="mb-6" onClick={() => navigate("/")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        {error || !campaign ? (
          <Card className="border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">{error || "Campaign not found."}</p>
          </Card>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="font-display text-3xl font-bold">Claim campaign</h1>
                <p className="mt-1 flex min-w-0 items-center gap-1 text-muted-foreground">
                  From
                  {campaign.issuerName ? (
                    <span className="truncate font-medium">{campaign.issuerName}</span>
                  ) : (
                    <MonoValue value={campaign.issuer} label="Issuer address" />
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {campaign.funded ? (
                  <NomineStatusBadge kind="lifecycle" value="AVAILABLE" />
                ) : (
                  <NomineStatusBadge kind="campaign" value={campaign.status} />
                )}
              </div>
            </div>

            {!isAuthenticated ? (
              <SignInHero
                issuer={issuer}
                amount={formatUsdcDisplay(campaign.allocation)}
                emailHint={maskEmail(user?.email)}
                onSignIn={() => navigate(nextPath)}
              />
            ) : isInboxLoading ? (
              <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="h-4 w-4 text-accent" /> Loading your claim…
              </div>
            ) : entitlement ? (
              <Card className="mb-6 min-w-0 border border-accent/30 bg-accent/5 p-6">
                <div className="mb-3 font-display text-lg font-semibold">
                  {formatUsdcDisplay(entitlement.amount)} for you
                </div>
                <ClaimAction
                  entitlement={entitlement}
                  wallets={wallets}
                  walletsLoading={isBalanceLoading}
                />
              </Card>
            ) : inboxError ? (
              <Card className="mb-6 min-w-0 border border-border bg-card p-6">
                <p className="text-sm text-muted-foreground">
                  We couldn&apos;t load your claim just now. Please try again.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => navigate("/inbox")}
                >
                  Open your Inbox
                </Button>
              </Card>
            ) : (
              <Card className="mb-6 min-w-0 border border-border bg-card p-6">
                <p className="text-sm text-muted-foreground">
                  This campaign has no claim waiting for your account.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => navigate("/inbox")}
                >
                  Open your Inbox
                </Button>
              </Card>
            )}

            <Card className="mb-6 min-w-0 border border-border bg-card p-6">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Coins className="h-5 w-5 text-accent" />
                <span className="font-display text-lg font-semibold">
                  {formatUsdcDisplay(campaign.allocation)} per recipient
                </span>
                <TestnetPill label="Test USDC · Arc Testnet" />
              </div>

              <div className="space-y-2">
                <NomineFactRow label="Allocation" value={formatUsdcDisplay(campaign.allocation)} mono />
                <NomineFactRow
                  label="Recipients"
                  value={
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" /> {campaign.entitlementCount}
                    </span>
                  }
                />
                <NomineFactRow label="Payout token" value="USDC (6 decimals)" />
                <NomineFactRow
                  label="Opens"
                  value={formatTimestampWithTimezone(campaign.openingTime)}
                />
                <NomineFactRow
                  label="Expires"
                  value={formatTimestampWithTimezone(campaign.expiryTime)}
                />
                <NomineFactRow
                  label="Funding"
                  value={
                    campaign.funded ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <ShieldCheck className="h-3 w-3" /> Verifiably funded on-chain
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not funded yet</span>
                    )
                  }
                />
              </div>

              {campaign.fundingTxHash ? (
                <div className="mt-4">
                  <a
                    href={explorerTxUrl(campaign.fundingTxHash) ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
                  >
                    Funding transaction <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ) : null}

              <div className="mt-4">
                <NomineDetails>
                  <NomineFactRow label="Issuer" value={campaign.issuer} mono />
                  <NomineFactRow label="Contract" value={campaign.contractAddress} mono />
                  <NomineFactRow label="Chain" value={campaign.chainId} />
                  <NomineFactRow
                    label="Approval"
                    value={
                      campaign.approvalMode === "auto"
                        ? "Automatic"
                        : campaign.approvalMode === "manual"
                        ? "Manual (issuer confirms)"
                        : "—"
                    }
                  />
                  <div className="space-y-2 border-t border-border pt-3">
                    <NomineAuthorityRow
                      role="Gate authority · issuer approver"
                      address={campaign.issuerApproverAddress}
                      note="Signs each approval"
                    />
                    <NomineAuthorityRow
                      role="Gate authority · Resolver (Nomine)"
                      address={campaign.resolverAddress}
                      note="Attaches settlement attestation"
                    />
                  </div>
                  {explorerAddressUrl(campaign.contractAddress) ? (
                    <a
                      href={explorerAddressUrl(campaign.contractAddress) ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
                    >
                      Contract on explorer <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </NomineDetails>
              </div>
            </Card>

            <Card className="mb-6 min-w-0 border border-border bg-card p-6">
              <div className="mb-3 flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-accent" />
                <h2 className="font-display text-lg font-semibold">How claiming works</h2>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  Eligibility is a verified email held by the identity provider — the same source used
                  to add you to the campaign.
                </li>
                <li>
                  Claiming is direct: USDC is paid to the wallet you sign with. Nomine relays the
                  transaction and sponsors the gas, so you need none.
                </li>
                <li>
                  {campaign.approvalMode === "auto"
                    ? "Confirm your wallet and the payout is sent automatically."
                    : "The issuer must confirm your claim before anything settles."}
                </li>
                <li>{RECOVERY_RULE}</li>
              </ul>
            </Card>

            <NomineDetails label="About this claim">
              <NomineDisclosure title="Verified-email eligibility">
                {ELIGIBILITY_NOTICE}
              </NomineDisclosure>
              <NomineDisclosure title="Direct USDC payout">{DIRECT_PAYOUT_NOTICE}</NomineDisclosure>
              <NomineDisclosure title="Issuer confirmation">
                {ISSUER_CONFIRMATION_NOTICE}
              </NomineDisclosure>
              <NomineDisclosure title="Fixed recovery rule">{RECOVERY_RULE}</NomineDisclosure>
              <NomineDisclosure title="Funding evidence">{FUNDING_NOTICE}</NomineDisclosure>
              <NomineDisclosure tone="warning" title="Two-authority risk">
                {D006_NOTICE}
              </NomineDisclosure>
            </NomineDetails>
          </>
        )}
      </div>
    </MainLayout>
  );
}
