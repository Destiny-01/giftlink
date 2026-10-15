/**
 * Studio - issuer surface.
 *
 * Three steps on one page (who gets paid, how much each, when), then a short review and one funding
 * action. Automatic approval is the default: the issuer funds once and the payouts land. Approving
 * each payout by hand is an explicit, collapsed choice for issuers who need it.
 *
 * The exact terms (contract, config hash, resolver, approver) live in a collapsed Details
 * disclosure, and the funding itself is a visible stepper so each broadcast transaction can be
 * checked on the explorer.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  Coins,
  Download,
  KeyRound,
  Mail,
  Users,
} from "lucide-react";
import { MainLayout } from "@/components/MainLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  explorerTxUrl,
  formatTimestampWithTimezone,
  formatUsdcDisplay,
  formatUsdcFixed,
  getClaimCoreConfig,
  isClaimCoreConfigured,
  usdcToBaseUnits,
} from "@/lib/claimCore";
import {
  DEFAULT_EXPIRY_PRESET,
  buildPreparePayload,
  computeTotalBaseUnits,
  parseRecipientEmails,
  presetExpiry,
  type ExpiryPreset,
} from "@/lib/campaignForm";
import { claimedCount } from "@/lib/campaignRecipients";
import {
  CampaignProgress,
  D006_NOTICE,
  ELIGIBILITY_NOTICE,
  FUNDING_NOTICE,
  ISSUER_KEY_NOTICE,
  NomineDetails,
  NomineDisclosure,
  NomineFactRow,
  NomineStatusBadge,
  RECOVERY_RULE,
} from "@/components/nomine";
import type { PrepareCampaignResponse, SigningWallet } from "@/types/nomine";

function toUnix(value: string): number | null {
  if (!value) return null;
  const ts = Math.floor(new Date(value).getTime() / 1000);
  return Number.isNaN(ts) ? null : ts;
}

/** A Date as the `datetime-local` input expects it, in the operator's own timezone. */
function toLocalInput(seconds: number): string {
  const date = new Date(seconds * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
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

const PRESET_LABELS: Record<ExpiryPreset, string> = {
  "24h": "24h",
  "7d": "7 days",
  "30d": "30 days",
  custom: "Custom",
};

function StepHeading({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-accent">
        {n}
      </span>
      <h3 className="font-display text-base font-semibold">{title}</h3>
    </div>
  );
}

export default function Studio() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  const { campaigns, isLoading: isCampaignsLoading, refresh } = useNomineCampaigns();
  const { prepare, isPreparing } = usePrepareNomineCampaign();
  const { fund, step, isLoading: isFunding, txs } = useFundNomineCampaign();

  const {
    wallets: walletBalances,
    isLoading: isBalanceLoading,
    refresh: refreshBalance,
  } = useWalletBalances();

  const [emailsText, setEmailsText] = useState("");
  const [allocation, setAllocation] = useState("");
  const [opening, setOpening] = useState("");
  const [expiry, setExpiry] = useState("");
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>(DEFAULT_EXPIRY_PRESET);
  const [advanced, setAdvanced] = useState(false);
  const [approver, setApprover] = useState("");
  const [selectedWallet, setSelectedWallet] = useState<string | undefined>();
  const [prepared, setPrepared] = useState<PrepareCampaignResponse | null>(null);
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">("checking");
  const [limits, setLimits] = useState<Record<
    string,
    string | number | boolean | null
  > | null>(null);
  /** `null` means the deployment has no automatic approver, so advanced approval is forced on. */
  const [autoApproverAvailable, setAutoApproverAvailable] = useState<boolean | null>(null);
  const [capMessage, setCapMessage] = useState<string | null>(null);

  const configured = isClaimCoreConfigured();
  const config = useMemo(() => {
    if (!configured) return null;
    const cfg = getClaimCoreConfig();
    return { address: cfg.address, chainId: cfg.chainId };
  }, [configured]);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      navigate("/app?next=/studio");
    }
  }, [isAuthLoading, isAuthenticated, navigate]);

  // The window opens now by default, with the standard 7-day expiry.
  useEffect(() => {
    const start = nowSeconds();
    setOpening((current) => current || toLocalInput(start));
    setExpiry((current) => current || toLocalInput(presetExpiry(DEFAULT_EXPIRY_PRESET, start)));
  }, []);

  // Studio access, pilot limits and the automatic-approver availability (WP2). An unreachable
  // access endpoint shows the form: the backend still enforces access at prepare time.
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
        if (cancelled) return;
        setLimits(entries.length > 0 ? cfg.limits ?? null : null);
        // Automatic approval needs a configured approver address. Anything else means the issuer
        // must supply one: an explicit null says this deployment has none, and an absent field
        // belongs to a backend that predates automatic approval and still requires the address.
        const autoAvailable =
          typeof cfg.autoApproverAddress === "string" &&
          cfg.autoApproverAddress.length > 0;
        setAutoApproverAvailable(autoAvailable);
        if (!autoAvailable) setAdvanced(true);
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

  const recipients = useMemo(() => parseRecipientEmails(emailsText), [emailsText]);

  const allocationBaseUnits = useMemo(() => {
    try {
      const value = parseFloat(allocation);
      if (!value || value <= 0) return null;
      return usdcToBaseUnits(allocation);
    } catch {
      return null;
    }
  }, [allocation]);

  const totalBaseUnits = useMemo(
    () => computeTotalBaseUnits(allocationBaseUnits, recipients.emails.length),
    [allocationBaseUnits, recipients.emails.length]
  );

  const selectedWalletData = walletBalances.find(
    (w: WalletBalance) => w.address === selectedWallet
  );

  const applyPreset = (preset: ExpiryPreset) => {
    setExpiryPreset(preset);
    if (preset === "custom") return;
    const openingTs = toUnix(opening) ?? nowSeconds();
    setExpiry(toLocalInput(presetExpiry(preset, openingTs)));
  };

  const handleOpeningChange = (value: string) => {
    setOpening(value);
    // Keep a preset expiry relative to the opening time the operator just chose.
    const openingTs = toUnix(value);
    if (openingTs && expiryPreset !== "custom") {
      setExpiry(toLocalInput(presetExpiry(expiryPreset, openingTs)));
    }
  };

  const handleReview = async () => {
    const openingTs = toUnix(opening);
    const expiryTs = toUnix(expiry);

    if (!allocationBaseUnits) {
      toast({ title: "Invalid amount", description: "Enter a USDC amount per recipient", variant: "destructive" });
      return;
    }
    if (recipients.emails.length === 0) {
      toast({ title: "Recipients required", description: "Add at least one verified email", variant: "destructive" });
      return;
    }
    if (recipients.invalid.length > 0) {
      toast({
        title: "Some entries are not emails",
        description: `Fix or remove: ${recipients.invalid.slice(0, 3).join(", ")}`,
        variant: "destructive",
      });
      return;
    }
    if (!openingTs || !expiryTs || expiryTs <= openingTs) {
      toast({ title: "Invalid window", description: "Expiry must be after opening", variant: "destructive" });
      return;
    }
    if (advanced && !/^0x[a-fA-F0-9]{40}$/.test(approver.trim())) {
      toast({
        title: "Approval wallet required",
        description:
          autoApproverAvailable === false
            ? "Enter the approval wallet address under Advanced."
            : "Enter a valid external address, or turn advanced approval off.",
        variant: "destructive",
      });
      return;
    }

    setCapMessage(null);

    try {
      const result = await prepare(
        buildPreparePayload({
          allocationBaseUnits,
          emails: recipients.emails,
          openingTime: openingTs,
          expiryTime: expiryTs,
          advanced,
          issuerApproverAddress: approver,
        })
      );
      setPrepared(result);
      // Retain the recipient mapping locally: Nomine stores only the salted hash, so this is the
      // only record that can tie a later approval request to a person the issuer recognises.
      saveRoster(result.campaignId, result.mapping);
    } catch (error: unknown) {
      // The backend is the authority on access; map its refusals to the same surfaces.
      const code = error instanceof ApiError ? error.code : undefined;
      if (code === "issuer_not_allowlisted") {
        setAccess("denied");
        return;
      }
      if (code === "campaign_cap_exceeded") {
        setCapMessage(error instanceof Error ? error.message : "Campaign limit reached");
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
        toast({ title: "Campaign is live", description: "The campaign is funded and recipients can claim" });
        refresh();
        refreshBalance();
        navigate(`/studio/${prepared.campaignId}`);
      } else {
        toast({ title: "Funding recorded", description: "Waiting for the backend to confirm", variant: "default" });
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

  const fundingStepIndex: Record<string, number> = {
    idle: 0,
    approving: 0,
    creating: 1,
    confirming: 2,
    funded: 3,
  };
  const currentFundingStep = fundingStepIndex[step] ?? 0;
  // "Live" is the last step, so reaching it means every earlier step finished too.
  const fundingComplete = step === "funded";
  const stepperSteps = [
    { label: "Approve USDC", tx: txs.approve },
    { label: "Fund campaign", tx: txs.fund },
    { label: "Confirming", tx: txs.fund },
    { label: "Live", tx: txs.fund },
  ];

  const advancedApprovalContent = (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-medium text-foreground">Approve each payout myself</div>
          <p className="mt-1 text-xs text-muted-foreground">
            {autoApproverAvailable === false
              ? "This deployment has no automatic approver, so every payout needs your signature."
              : "Off means payouts are approved automatically when each recipient claims."}
          </p>
        </div>
        <Switch
          checked={advanced}
          onCheckedChange={setAdvanced}
          disabled={autoApproverAvailable === false}
          aria-label="Approve each payout myself"
        />
      </div>

      {advanced ? (
        <div className="space-y-2 border-t border-border pt-3">
          <Label htmlFor="approver" className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Approval wallet address
          </Label>
          <Input
            id="approver"
            placeholder="0x…"
            value={approver}
            onChange={(e) => setApprover(e.target.value)}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Use a wallet that&apos;s different from the one you fund with. You&apos;ll sign each
            payout before it&apos;s sent.
          </p>
          <p className="text-xs text-muted-foreground">{ISSUER_KEY_NOTICE}</p>
        </div>
      ) : null}
    </>
  );

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
            Fund a private, verified-email campaign
          </p>
        </div>

        {!configured ? (
          <NomineDisclosure tone="warning" title="Claiming is not configured" className="mb-6">
            This deployment is missing its claim contract configuration, so funding is disabled.
          </NomineDisclosure>
        ) : null}

        {access === "denied" ? (
          <Card className="mb-8 min-w-0 border border-border bg-card p-6">
            <h2 className="font-display text-xl font-semibold">
              Studio is invite-only during the pilot
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Nomine is onboarding issuers one at a time. To run a campaign, reach out to @usenomine
              on X.
            </p>
          </Card>
        ) : access === "checking" ? (
          <Card className="mb-8 flex items-center gap-2 border border-border bg-card p-6 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4 text-accent" />
            Checking Studio access…
          </Card>
        ) : prepared ? (
          <Card className="mb-8 min-w-0 border border-border bg-card p-6">
            <h2 className="mb-4 font-display text-xl font-semibold">Review and fund</h2>

            <div className="space-y-2">
              <NomineFactRow label="Recipients" value={prepared.entitlementCount} />
              <NomineFactRow
                label="Amount each"
                value={formatUsdcDisplay(prepared.config.allocation)}
              />
              <NomineFactRow
                label="Total"
                value={formatUsdcDisplay(prepared.budget)}
                mono
              />
              <NomineFactRow
                label="Opens"
                value={formatTimestampWithTimezone(prepared.config.openingTime)}
              />
              <NomineFactRow
                label="Expires"
                value={formatTimestampWithTimezone(prepared.config.expiryTime)}
              />
              <NomineFactRow
                label="Approval"
                value={advanced ? "You approve each payout" : "Automatic"}
              />
            </div>

            <div className="mt-4">
              <NomineDetails>
                <NomineFactRow label="Contract" value={config?.address ?? ""} mono />
                <NomineFactRow label="Approver" value={prepared.config.issuerApprover} mono />
                <NomineFactRow label="Resolver" value={prepared.config.resolver} mono />
                <NomineFactRow label="Config hash" value={prepared.paramsHash} mono />
                <NomineFactRow label="Chain" value={config?.chainId ?? CLAIM_CORE_CHAIN_ID} />
                <div className="space-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
                  <p>{ISSUER_KEY_NOTICE}</p>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => downloadRoster(prepared.campaignId, prepared.mapping)}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download recipient mapping (CSV)
                    </Button>
                    <p className="mt-2">
                      Nomine keeps only a salted hash of each address, so this record is what lets you
                      match a later payout request to a person. Keep your own copy.
                    </p>
                  </div>
                </div>
              </NomineDetails>
            </div>

            {/* Funding stepper: one row per broadcast step, each with its own explorer link. */}
            <ol className="mt-6 space-y-2">
              {stepperSteps.map((item, index) => {
                const done = fundingComplete || index < currentFundingStep;
                const active = !fundingComplete && index === currentFundingStep;
                const txUrl = item.tx ? explorerTxUrl(item.tx) : null;
                return (
                  <li
                    key={item.label}
                    className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                  >
                    <span
                      className={
                        done
                          ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/20 text-success"
                          : active
                          ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent"
                          : "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                      }
                    >
                      {done ? (
                        <Check className="h-3 w-3" />
                      ) : active && isFunding ? (
                        <Spinner className="h-3 w-3" />
                      ) : (
                        <span className="text-[10px]">{index + 1}</span>
                      )}
                    </span>
                    <span className={done || active ? "text-foreground" : "text-muted-foreground"}>
                      {item.label}
                    </span>
                    {done && txUrl ? (
                      <a
                        href={txUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-accent hover:underline"
                      >
                        View transaction
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ol>

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
                    {step === "approving"
                      ? "Approving USDC…"
                      : step === "creating"
                      ? "Funding the campaign…"
                      : "Confirming…"}
                  </>
                ) : (
                  <>
                    Fund {formatUsdcDisplay(prepared.budget)}
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
          <Card className="mb-8 min-w-0 border border-border bg-card p-6">
            <h2 className="mb-1 font-display text-xl font-semibold">New campaign</h2>
            <p className="mb-6 text-sm text-muted-foreground">
              Three things: who gets paid, how much each, and when.
            </p>

            <div className="space-y-8">
              {/* 1. Who gets paid */}
              <section className="space-y-2">
                <StepHeading n={1} title="Who gets paid" />
                <Label htmlFor="recipients" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" /> Verified emails
                </Label>
                <Textarea
                  id="recipients"
                  rows={6}
                  placeholder={"alice@example.com\nbob@example.com"}
                  value={emailsText}
                  onChange={(e) => setEmailsText(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {recipients.emails.length} recipient
                  {recipients.emails.length === 1 ? "" : "s"}
                  {recipients.duplicates.length > 0
                    ? ` · ${recipients.duplicates.length} duplicate${
                        recipients.duplicates.length === 1 ? "" : "s"
                      } ignored`
                    : ""}
                </p>
                {recipients.invalid.length > 0 ? (
                  <p className="text-xs text-danger">
                    Not valid emails: {recipients.invalid.slice(0, 5).join(", ")}
                    {recipients.invalid.length > 5
                      ? ` and ${recipients.invalid.length - 5} more`
                      : ""}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Newlines, commas and semicolons all work. Duplicates are ignored.
                </p>
              </section>

              {/* 2. How much each */}
              <section className="space-y-2">
                <StepHeading n={2} title="How much each" />
                <Label htmlFor="allocation" className="flex items-center gap-2">
                  <Coins className="h-4 w-4" /> Amount per recipient (USDC)
                  <TestnetPill label="Test USDC · Arc Testnet" />
                </Label>
                <Input
                  id="allocation"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="25.00"
                  value={allocation}
                  onChange={(e) => setAllocation(e.target.value)}
                />
                {totalBaseUnits ? (
                  <p className="text-sm">
                    Total:{" "}
                    <span className="font-medium">
                      {formatUsdcFixed(totalBaseUnits)} USDC
                    </span>
                  </p>
                ) : null}
                {limitRows.length > 0 ? (
                  <div className="rounded-lg border border-border bg-surface/50 p-3 text-xs">
                    <p className="font-medium text-foreground">Pilot limits</p>
                    <dl className="mt-1 space-y-0.5">
                      {limitRows.map(([key, value]) => (
                        <div key={key} className="flex items-baseline justify-between gap-4">
                          <dt className="text-muted-foreground">{limitLabel(key)}</dt>
                          <dd className="font-mono text-foreground">{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ) : null}
              </section>

              {/* 3. When */}
              <section className="space-y-3">
                <StepHeading n={3} title="When" />
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="opens" className="flex items-center gap-2">
                      <CalendarClock className="h-4 w-4" /> Opens
                    </Label>
                    <Input
                      id="opens"
                      type="datetime-local"
                      value={opening}
                      onChange={(e) => handleOpeningChange(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="expires" className="flex items-center gap-2">
                      <CalendarClock className="h-4 w-4" /> Expires
                    </Label>
                    <Input
                      id="expires"
                      type="datetime-local"
                      value={expiry}
                      onChange={(e) => {
                        // A hand-edited expiry is the operator's own value from here on, so a later
                        // change to the opening time must not snap it back to the preset.
                        setExpiry(e.target.value);
                        setExpiryPreset("custom");
                      }}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(PRESET_LABELS) as ExpiryPreset[]).map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      variant={expiryPreset === preset ? "default" : "outline"}
                      className={
                        expiryPreset === preset
                          ? "bg-accent text-accent-foreground hover:bg-accent/90"
                          : undefined
                      }
                      onClick={() => applyPreset(preset)}
                    >
                      {PRESET_LABELS[preset]}
                    </Button>
                  ))}
                </div>
              </section>

              {/* Approval. When this deployment has no automatic approver the section is not
                  collapsed: the address the backend requires must not be hidden. */}
              <section className="space-y-3 border-t border-border pt-6">
                {autoApproverAvailable === false ? (
                  <>
                    <h3 className="font-display text-base font-semibold">
                      Advanced: approve each payout yourself
                    </h3>
                    {advancedApprovalContent}
                  </>
                ) : (
                  <NomineDetails label="Advanced: approve each payout yourself">
                    {advancedApprovalContent}
                  </NomineDetails>
                )}
              </section>

              <NomineDisclosure title="Eligibility">{ELIGIBILITY_NOTICE}</NomineDisclosure>

              {capMessage ? <p className="text-sm text-danger">{capMessage}</p> : null}

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
                    Review &amp; fund
                    {totalBaseUnits ? ` ${formatUsdcDisplay(totalBaseUnits)}` : ""}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </Card>
        )}

        {/* Existing campaigns */}
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
                <Card className="min-w-0 border border-border bg-card p-4 transition-colors hover:border-accent/40">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {campaign.name ||
                            `${campaign.entitlementCount} recipients · ${formatUsdcDisplay(
                              campaign.allocation
                            )} each`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Opens {formatTimestampWithTimezone(campaign.openingTime)} · Expires{" "}
                          {formatTimestampWithTimezone(campaign.expiryTime)}
                        </div>
                      </div>
                    </div>
                    <NomineStatusBadge kind="campaign" value={campaign.status} />
                  </div>
                  <CampaignProgress
                    className="mt-3"
                    claimed={claimedCount(campaign, [])}
                    total={campaign.entitlementCount}
                    settled={campaign.accounting?.settled ?? "0"}
                    budget={campaign.accounting?.budget ?? "0"}
                  />
                </Card>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8">
          <NomineDetails label="About campaigns">
            <NomineDisclosure title="Funding evidence">{FUNDING_NOTICE}</NomineDisclosure>
            <NomineDisclosure title="Recovery">{RECOVERY_RULE}</NomineDisclosure>
            <NomineDisclosure tone="warning" title="Two-authority risk">
              {D006_NOTICE}
            </NomineDisclosure>
          </NomineDetails>
        </div>
      </div>
    </MainLayout>
  );
}
