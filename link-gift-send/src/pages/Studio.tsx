/**
 * Studio - issuer surface.
 *
 * Define a campaign: a fixed USDC allocation, a private verified-email list, opening/expiry and a
 * distinct external issuer-approval address. Review every immutable term, then fund from the
 * connected wallet through a step machine. "Funded" is only shown after the backend confirms the
 * canonical CampaignFunded event.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Coins,
  KeyRound,
  Mail,
  Plus,
  Users,
} from "lucide-react";
import { MainLayout } from "@/components/MainLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FullPageLoader, Spinner } from "@/components/Loader";
import { WalletSelector } from "@/components/WalletSelector";
import { TestnetPill } from "@/components/TestnetPill";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useAccount, useSwitchChain } from "wagmi";
import { downloadRoster, saveRoster } from "@/lib/issuerRoster";
import { ensureArcNetwork } from "@/lib/chainUtils";
import * as api from "@/services/api";
import { ApiError } from "@/lib/utils";
import {
  useFundNomineCampaign,
  useNomineCampaigns,
  usePrepareNomineCampaign,
} from "@/hooks/useNomineCampaign";
import {
  CLAIM_CORE_CHAIN_ID,
  formatTimestampWithTimezone,
  formatUsdcDisplay,
  isClaimCoreConfigured,
  usdcToBaseUnits,
} from "@/lib/claimCore";
import {
  D006_NOTICE,
  ELIGIBILITY_NOTICE,
  FUNDING_NOTICE,
  ISSUER_KEY_NOTICE,
  NomineDisclosure,
  NomineFactRow,
  NomineStatusBadge,
  RECOVERY_RULE,
} from "@/components/nomine";
import type { PrepareCampaignResponse, SigningWallet } from "@/types/nomine";

function parseEmails(text: string): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const email = raw.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(email);
  }
  return list;
}

function toUnix(value: string): number | null {
  if (!value) return null;
  const ts = Math.floor(new Date(value).getTime() / 1000);
  return Number.isNaN(ts) ? null : ts;
}

/** "max_recipients" -> "Max recipients". The server owns the names; we only present them. */
function humanizeLimitKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Known WP2 limit keys get a readable label; anything else falls back to the key itself. */
const LIMIT_LABELS: Record<string, string> = {
  maxBudgetUsdc: "Max budget (USDC)",
  maxRecipients: "Max recipients",
};

function limitLabel(key: string): string {
  return LIMIT_LABELS[key] ?? humanizeLimitKey(key);
}

export default function Studio() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { address: activeAddress, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  const { campaigns, isLoading: isCampaignsLoading, refresh } = useNomineCampaigns();
  const { prepare, isPreparing } = usePrepareNomineCampaign();
  const { fund, step, isLoading: isFunding } = useFundNomineCampaign();

  const {
    wallets: walletBalances,
    isLoading: isBalanceLoading,
    refresh: refreshBalance,
  } = useWalletBalances();

  const [allocation, setAllocation] = useState("");
  const [emailsText, setEmailsText] = useState("");
  const [opening, setOpening] = useState("");
  const [expiry, setExpiry] = useState("");
  const [approver, setApprover] = useState("");
  const [selectedWallet, setSelectedWallet] = useState<string | undefined>();
  const [prepared, setPrepared] = useState<PrepareCampaignResponse | null>(null);
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">(
    "checking"
  );
  const [limits, setLimits] = useState<Record<
    string,
    string | number | boolean | null
  > | null>(null);
  const [capMessage, setCapMessage] = useState<string | null>(null);

  const configured = isClaimCoreConfigured();

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      navigate("/app?next=/studio");
    }
  }, [isAuthLoading, isAuthenticated, navigate]);

  // Studio access and pilot limits (WP2). An unreachable access endpoint shows the form: the
  // backend still enforces access at prepare time.
  useEffect(() => {
    if (isAuthLoading || !isAuthenticated) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await api.getStudioAccess();
        if (!cancelled) setAccess(result.allowed ? "allowed" : "denied");
      } catch {
        if (!cancelled) setAccess("allowed");
      }
    })();

    (async () => {
      try {
        const cfg = await api.getNomineConfig();
        const entries = Object.entries(cfg.limits ?? {});
        if (!cancelled) setLimits(entries.length > 0 ? cfg.limits ?? null : null);
      } catch {
        if (!cancelled) setLimits(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthLoading, isAuthenticated]);

  // Only the limits the server actually set are shown; unset (null) keys are skipped.
  const limitRows: Array<[string, string | number | boolean]> = limits
    ? Object.entries(limits).filter(
        (entry): entry is [string, string | number | boolean] =>
          entry[1] !== null && entry[1] !== undefined
      )
    : [];

  type WalletBalance = (typeof walletBalances)[number];

  useEffect(() => {
    if (!selectedWallet && walletBalances.length > 0) {
      const first = walletBalances.find((w: WalletBalance) => w.isEnabled);
      if (first) setSelectedWallet(first.address);
    }
  }, [walletBalances, selectedWallet]);

  const emails = useMemo(() => parseEmails(emailsText), [emailsText]);

  const allocationBaseUnits = useMemo(() => {
    try {
      const value = parseFloat(allocation);
      if (!value || value <= 0) return null;
      return usdcToBaseUnits(allocation);
    } catch {
      return null;
    }
  }, [allocation]);

  const estimatedTotalBaseUnits = useMemo(() => {
    if (!allocationBaseUnits || emails.length === 0) return null;
    return allocationBaseUnits * BigInt(emails.length);
  }, [allocationBaseUnits, emails.length]);

  const selectedWalletData = walletBalances.find(
    (w: WalletBalance) => w.address === selectedWallet
  );

  const handleReview = async () => {
    const openingTs = toUnix(opening);
    const expiryTs = toUnix(expiry);

    if (!allocationBaseUnits) {
      toast({ title: "Invalid allocation", description: "Enter a USDC amount per recipient", variant: "destructive" });
      return;
    }
    if (emails.length === 0) {
      toast({ title: "Recipients required", description: "Add at least one verified email", variant: "destructive" });
      return;
    }
    if (!openingTs || !expiryTs || expiryTs <= openingTs) {
      toast({ title: "Invalid window", description: "Expiry must be after opening", variant: "destructive" });
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(approver.trim())) {
      toast({ title: "Invalid approval address", description: "Enter a valid external issuer-approval address", variant: "destructive" });
      return;
    }

    setCapMessage(null);

    try {
      const result = await prepare({
        allocation: allocationBaseUnits.toString(),
        emails,
        openingTime: openingTs,
        expiryTime: expiryTs,
        issuerApproverAddress: approver.trim(),
      });
      setPrepared(result);
      // Retain the recipient mapping locally: Nomine stores only the salted hash, so this is the
      // only record that can tie a later approval request to a person the issuer recognises.
      saveRoster(result.campaignId, result.mapping);
      toast({ title: "Draft prepared", description: "Review the immutable terms before funding" });
    } catch (error: unknown) {
      // The backend is the authority on access; map its refusals to the same surfaces.
      const code = error instanceof ApiError ? error.code : undefined;
      if (code === "issuer_not_allowlisted") {
        setAccess("denied");
        return;
      }
      if (code === "campaign_cap_exceeded") {
        setCapMessage(
          error instanceof Error ? error.message : "Campaign limit reached"
        );
        return;
      }
      toast({
        title: "Could not prepare campaign",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleFund = async () => {
    if (!prepared) return;
    if (!selectedWallet || !selectedWalletData) {
      toast({ title: "Wallet required", description: "Select a wallet to fund from", variant: "destructive" });
      return;
    }

    const signingWallet: SigningWallet = {
      address: selectedWallet as `0x${string}`,
      walletType: selectedWalletData.walletType === "privy" ? "privy" : "external",
    };

    try {
      if (signingWallet.walletType === "external" && switchChain) {
        const isOnArc = await ensureArcNetwork(
          () =>
            switchChain(
              { chainId: CLAIM_CORE_CHAIN_ID },
              {
                onError: (error) =>
                  console.error("Failed to switch chain:", error instanceof Error ? error.message : error),
              }
            ),
          () => chainId,
          true
        );
        if (!isOnArc) return;
      }

      const funded = await fund(prepared, signingWallet);
      if (funded?.status === "FUNDED") {
        toast({ title: "Campaign funded", description: "The canonical CampaignFunded event is confirmed" });
        setPrepared(null);
        setAllocation("");
        setEmailsText("");
        setOpening("");
        setExpiry("");
        setApprover("");
        refresh();
        refreshBalance();
      } else {
        toast({ title: "Funding recorded", description: "Awaiting backend confirmation", variant: "default" });
      }
    } catch (error: unknown) {
      toast({
        title: "Funding failed",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  if (isAuthLoading) return <FullPageLoader />;

  const stepLabel: Record<string, string> = {
    idle: "Fund campaign",
    approving: "Approving USDC…",
    creating: "Creating campaign on-chain…",
    confirming: "Confirming funding event…",
    funded: "Funded",
  };

  return (
    <MainLayout>
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Button variant="ghost" className="mb-6" onClick={() => navigate("/inbox")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Inbox
        </Button>

        <div className="mb-6">
          <h1 className="font-display text-3xl font-bold">Studio</h1>
          <p className="mt-2 text-muted-foreground">
            Fund a private, verified-email Claim Core campaign
          </p>
        </div>

        {!configured ? (
          <NomineDisclosure tone="warning" title="Claim Core not configured" className="mb-6">
            VITE_CLAIM_CORE_ADDRESS is not set. Nomine fails closed and will not send a transaction
            until the Claim Core address and chain are configured.
          </NomineDisclosure>
        ) : null}

        {access === "denied" ? (
          // ------ Invite-only pilot ------
          <Card className="mb-8 border border-border bg-card p-6">
            <h2 className="font-display text-xl font-semibold">
              Studio is invite-only during the pilot
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Nomine is onboarding issuers one at a time. To run a campaign, reach
              out to @usenomine on X.
            </p>
          </Card>
        ) : access === "checking" ? (
          <Card className="mb-8 flex items-center gap-2 border border-border bg-card p-6 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4 text-accent" />
            Checking Studio access…
          </Card>
        ) : prepared ? (
          // ------ Review immutable terms ------
          <Card className="mb-8 border border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-accent" />
              <h2 className="font-display text-xl font-semibold">Review immutable terms</h2>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              These terms are fixed once funded. Entitlement identifiers are high-entropy and are
              never derived from an email.
            </p>

            <div className="space-y-2">
              <NomineFactRow label="Allocation per recipient" value={formatUsdcDisplay(prepared.config.allocation)} mono />
              <NomineFactRow label="Exact recipient count" value={prepared.entitlementCount} />
              <NomineFactRow label="Total funding requirement" value={formatUsdcDisplay(prepared.budget)} mono />
              <NomineFactRow label="Opens" value={formatTimestampWithTimezone(prepared.config.openingTime)} />
              <NomineFactRow label="Expires" value={formatTimestampWithTimezone(prepared.config.expiryTime)} />
              <NomineFactRow label="Issuer-approval address" value={prepared.config.issuerApprover} mono />
              <NomineFactRow label="Resolver address" value={prepared.config.resolver} mono />
              <NomineFactRow label="Entitlement root" value={prepared.entitlementRoot} mono />
              <div className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">
                  Recipient mapping — keep your own copy
                </div>
                <p className="mt-1">
                  Nomine keeps only a salted hash of each address, so it cannot tell you who a later
                  approval request belongs to. This record is what lets you verify a wallet
                  assignment independently. Download it and store it outside Nomine.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => downloadRoster(prepared.campaignId, prepared.mapping)}
                >
                  Download recipient mapping (CSV)
                </Button>
              </div>
              <NomineFactRow label="Chain" value={CLAIM_CORE_CHAIN_ID} />
            </div>

            <NomineDisclosure className="mt-4" title="Your approval key">
              {ISSUER_KEY_NOTICE}
            </NomineDisclosure>

            <WalletSelector
              wallets={walletBalances}
              selectedWallet={selectedWallet}
              onSelectWallet={setSelectedWallet}
              isLoading={isBalanceLoading}
            />

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button
                size="lg"
                className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={handleFund}
                disabled={isFunding || !selectedWallet || !configured}
              >
                {isFunding ? (
                  <>
                    <Spinner className="mr-2 h-4 w-4" />
                    {stepLabel[step] ?? "Funding…"}
                  </>
                ) : (
                  <>
                    Fund campaign
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="flex-1"
                onClick={() => setPrepared(null)}
                disabled={isFunding}
              >
                Back
              </Button>
            </div>
          </Card>
        ) : (
          // ------ Define campaign ------
          <Card className="mb-8 border border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <Plus className="h-5 w-5 text-accent" />
              <h2 className="font-display text-xl font-semibold">New campaign</h2>
            </div>
            <p className="mb-6 text-sm text-muted-foreground">
              A fixed USDC allocation per recipient, a private verified-email list, an opening/expiry
              window, and a distinct external issuer-approval address.
            </p>

            <div className="space-y-5">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Coins className="h-4 w-4" /> Allocation per recipient (USDC)
                  <TestnetPill label="Test USDC · Arc Testnet" />
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="25.00"
                  value={allocation}
                  onChange={(e) => setAllocation(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Mail className="h-4 w-4" /> Private verified-email list
                </Label>
                <Textarea
                  rows={6}
                  placeholder={"alice@example.com\nbob@example.com"}
                  value={emailsText}
                  onChange={(e) => setEmailsText(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {emails.length} recipient{emails.length === 1 ? "" : "s"} entered. The server
                  normalizes and dedups emails and assigns identifiers.
                </p>
              </div>

              {limitRows.length > 0 ? (
                <div className="rounded-lg border border-border bg-surface/50 p-4 text-sm">
                  <p className="font-medium">Pilot limits</p>
                  <dl className="mt-2 space-y-1">
                    {limitRows.map(([key, value]) => (
                      <div
                        key={key}
                        className="flex items-baseline justify-between gap-4 text-muted-foreground"
                      >
                        <dt>{limitLabel(key)}</dt>
                        <dd className="font-mono text-foreground">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}

              <NomineDisclosure title="Eligibility">{ELIGIBILITY_NOTICE}</NomineDisclosure>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4" /> Opens
                  </Label>
                  <Input type="datetime-local" value={opening} onChange={(e) => setOpening(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4" /> Expires
                  </Label>
                  <Input type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4" /> External issuer-approval address
                </Label>
                <Input
                  placeholder="0x…"
                  value={approver}
                  onChange={(e) => setApprover(e.target.value)}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  A distinct external wallet, different from the funding wallet. Each claim needs an
                  Approval signature from this address.
                </p>
              </div>

              <NomineDisclosure tone="warning" title="Issuer key">
                {ISSUER_KEY_NOTICE}
              </NomineDisclosure>

              {estimatedTotalBaseUnits ? (
                <div className="rounded-lg border border-border bg-surface/50 p-4 space-y-2">
                  <NomineFactRow label="Recipients (estimate)" value={emails.length} />
                  <NomineFactRow
                    label="Total funding (estimate)"
                    value={formatUsdcDisplay(estimatedTotalBaseUnits)}
                    mono
                  />
                </div>
              ) : null}

              {capMessage ? (
                <p className="text-sm text-danger">{capMessage}</p>
              ) : null}

              <Button
                size="lg"
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={handleReview}
                disabled={isPreparing || !configured}
              >
                {isPreparing ? (
                  <>
                    <Spinner className="mr-2 h-4 w-4" />
                    Preparing…
                  </>
                ) : (
                  <>
                    Review terms
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </Card>
        )}

        {/* ------ Existing campaigns ------ */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Your campaigns</h2>
          {isCampaignsLoading ? <Spinner className="h-4 w-4 text-accent" /> : null}
        </div>

        {campaigns.length === 0 && !isCampaignsLoading ? (
          <p className="text-sm text-muted-foreground">No campaigns yet.</p>
        ) : (
          <div className="space-y-3">
            {campaigns.map((campaign) => (
              <Link key={campaign.id} to={`/studio/${campaign.id}`} className="block">
                <Card className="border border-border bg-card p-4 transition-colors hover:border-accent/40">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="font-medium">
                          {campaign.entitlementCount} recipients ·{" "}
                          {formatUsdcDisplay(campaign.allocation)} each
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Opens {formatTimestampWithTimezone(campaign.openingTime)} · Expires{" "}
                          {formatTimestampWithTimezone(campaign.expiryTime)}
                        </div>
                      </div>
                    </div>
                    <NomineStatusBadge kind="campaign" value={campaign.status} />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8 space-y-3">
          <NomineDisclosure title="Funding evidence">{FUNDING_NOTICE}</NomineDisclosure>
          <NomineDisclosure title="Recovery">{RECOVERY_RULE}</NomineDisclosure>
          <NomineDisclosure tone="warning" title="Two-authority risk">
            {D006_NOTICE}
          </NomineDisclosure>
        </div>
      </div>
    </MainLayout>
  );
}
