/**
 * CampaignLink - public link view.
 *
 * No roster, no eligibility enumeration. Shows the issuer, verifiable funding, allocation, the
 * verified-email eligibility source, both Gate authorities, the opening/expiry window with
 * timezone, the direct USDC payout, the fixed recovery rule, and that the issuer confirmation is
 * required before consent.
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FullPageLoader } from "@/components/Loader";
import * as api from "@/services/api";
import {
  explorerAddressUrl,
  explorerTxUrl,
  formatTimestampWithTimezone,
  formatUsdcDisplay,
} from "@/lib/claimCore";
import {
  DIRECT_PAYOUT_NOTICE,
  D006_NOTICE,
  ELIGIBILITY_NOTICE,
  FUNDING_NOTICE,
  ISSUER_CONFIRMATION_NOTICE,
  NomineAuthorityRow,
  NomineDisclosure,
  NomineFactRow,
  NomineStatusBadge,
  RECOVERY_RULE,
} from "@/components/nomine";
import type { CampaignPublicView } from "@/types/nomine";

export default function CampaignLink() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();

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
              <div>
                <h1 className="font-display text-3xl font-bold">Claim campaign</h1>
                <p className="mt-1 text-muted-foreground">
                  From <span className="font-mono">{campaign.issuerName || campaign.issuer}</span>
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

            <Card className="mb-6 border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <Coins className="h-5 w-5 text-accent" />
                <span className="font-display text-lg font-semibold">
                  {formatUsdcDisplay(campaign.allocation)} per recipient
                </span>
              </div>

              <div className="space-y-2">
                <NomineFactRow label="Issuer" value={campaign.issuer} mono />
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
                <NomineFactRow label="Chain" value={campaign.chainId} />
                <NomineFactRow label="Contract" value={campaign.contractAddress} mono />
                <NomineFactRow label="Opens" value={formatTimestampWithTimezone(campaign.openingTime)} />
                <NomineFactRow label="Expires" value={formatTimestampWithTimezone(campaign.expiryTime)} />
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

              <div className="mt-4 space-y-2 border-t border-border pt-4">
                <NomineAuthorityRow
                  role="Gate authority · issuer approver"
                  address={campaign.issuerApproverAddress}
                  note="Signs each Approval"
                />
                <NomineAuthorityRow
                  role="Gate authority · Resolver (Nomine)"
                  address={campaign.resolverAddress}
                  note="Attaches settlement attestation"
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-4 text-sm">
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

            <Card className="mb-6 border border-border bg-card p-6">
              <div className="mb-3 flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-accent" />
                <h2 className="font-display text-lg font-semibold">How claiming works</h2>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  Eligibility is a verified email held by the identity provider — the same source
                  used to add you to the campaign.
                </li>
                <li>
                  Claiming is direct: USDC is paid to the wallet you sign with. Nomine relays the
                  transaction and sponsors gas after both Gate authorities authorize it.
                </li>
                <li>
                  Consent alone does not settle. The issuer must confirm your consent before
                  anything settles.
                </li>
                <li>{RECOVERY_RULE}</li>
              </ul>

              <Button
                className="mt-4 w-full bg-accent text-accent-foreground hover:bg-accent/90"
                size="lg"
                onClick={() => navigate("/inbox")}
              >
                Sign in to claim
              </Button>
            </Card>

            <div className="space-y-3">
              <NomineDisclosure title="Verified-email eligibility">{ELIGIBILITY_NOTICE}</NomineDisclosure>
              <NomineDisclosure title="Direct USDC payout">{DIRECT_PAYOUT_NOTICE}</NomineDisclosure>
              <NomineDisclosure title="Issuer confirmation required">{ISSUER_CONFIRMATION_NOTICE}</NomineDisclosure>
              <NomineDisclosure title="Fixed recovery rule">{RECOVERY_RULE}</NomineDisclosure>
              <NomineDisclosure title="Funding evidence">{FUNDING_NOTICE}</NomineDisclosure>
              <NomineDisclosure tone="warning" title="Two-authority risk">{D006_NOTICE}</NomineDisclosure>
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
}
