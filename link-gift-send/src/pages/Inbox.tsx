/**
 * Inbox - claimant surface.
 *
 * Sign in and see only your own entitlements. Each claimable item has a single primary button that
 * signs consent, posts it, and settles - so a claimant presses once and sees "Paid" with a receipt.
 * Awaiting-issuer, sending and failure states are plain-language copy; the technical facts sit in a
 * collapsed Details disclosure.
 */

import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Clock,
  Gift,
  Inbox as InboxIcon,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { MainLayout } from "@/components/MainLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FullPageLoader, Spinner } from "@/components/Loader";
import { TestnetPill } from "@/components/TestnetPill";
import { useAuth } from "@/hooks/useAuth";
import { useWalletBalances, type WalletBalance } from "@/hooks/useWalletBalances";
import { useNomineInbox } from "@/hooks/useNomineInbox";
import {
  formatTimestampWithTimezone,
  formatUsdcDisplay,
  isClaimCoreConfigured,
} from "@/lib/claimCore";
import {
  ClaimAction,
  MonoValue,
  NomineChip,
  NomineDisclosure,
  NomineReceiptPanel,
  NomineStatusBadge,
} from "@/components/nomine";
import type { NomineEntitlement } from "@/types/nomine";
import { settlementReceiptFor } from "@/lib/claimFlow";

function EntitlementCard({
  entitlement,
  wallets,
  walletsLoading,
  onChanged,
}: {
  entitlement: NomineEntitlement;
  wallets: WalletBalance[];
  walletsLoading: boolean;
  onChanged: () => void;
}) {
  const campaign = entitlement.campaign;
  const now = Math.floor(Date.now() / 1000);
  const opensAt = entitlement.opensAt ?? campaign?.openingTime ?? 0;
  const preOpening = opensAt > now;
  const request = entitlement.request;
  const completed =
    entitlement.status === "COMPLETED" ||
    request?.status === "SETTLED" ||
    Boolean(request?.receipt);
  const expired = entitlement.status === "EXPIRED";
  const receipt = settlementReceiptFor(entitlement);

  return (
    <Card className="min-w-0 border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2 font-medium">
            <span className="min-w-0 truncate">
              {campaign?.issuerName || "Campaign"} · {formatUsdcDisplay(entitlement.amount)}
            </span>
            <TestnetPill label="Test USDC · Arc Testnet" />
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            From <MonoValue value={campaign?.issuer} label="Issuer address" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {preOpening && !completed ? (
            <NomineChip className="border-accent/40 text-accent">
              <Clock className="h-3 w-3" /> Opens {formatTimestampWithTimezone(opensAt)}
            </NomineChip>
          ) : null}
          {request && !completed ? (
            <NomineStatusBadge kind="request" value={request.status} />
          ) : (
            <NomineStatusBadge
              kind="lifecycle"
              value={completed ? "COMPLETED" : expired ? "EXPIRED" : "AVAILABLE"}
            />
          )}
        </div>
      </div>

      {completed ? (
        receipt ? (
          <NomineReceiptPanel receipt={receipt} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Paid. Refresh to see the receipt.
          </p>
        )
      ) : expired ? (
        <p className="text-sm text-muted-foreground">This claim has expired.</p>
      ) : preOpening ? (
        <p className="text-sm text-muted-foreground">
          Claiming opens {formatTimestampWithTimezone(opensAt)}.
        </p>
      ) : (
        <ClaimAction
          entitlement={entitlement}
          wallets={wallets}
          walletsLoading={walletsLoading}
          onSettled={onChanged}
        />
      )}
    </Card>
  );
}

function EmptyInbox({ email }: { email?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card px-6 py-12 text-center">
      <InboxIcon className="h-8 w-8 text-muted-foreground" />
      <p className="font-display text-lg font-semibold">Nothing to claim yet.</p>
      <p className="text-sm text-muted-foreground">
        When someone sends value to {email || "your email"}, it shows up here.
      </p>
      <Link to="/studio" className="mt-2 text-sm text-accent hover:underline">
        Sending value? Open Studio →
      </Link>
    </div>
  );
}

export default function Inbox() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: isAuthLoading, user } = useAuth();
  const { grouping, isLoading, error, refresh } = useNomineInbox({ pollMs: 30000 });
  const { wallets, isLoading: isBalanceLoading } = useWalletBalances();

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      navigate("/app?next=/inbox");
    }
  }, [isAuthLoading, isAuthenticated, navigate]);

  if (isAuthLoading) return <FullPageLoader />;

  const configured = isClaimCoreConfigured();
  const isEmpty =
    grouping.available.length === 0 &&
    grouping.completed.length === 0 &&
    grouping.expired.length === 0;

  const renderGroup = (items: NomineEntitlement[]) => (
    <div className="space-y-4">
      {items.map((entitlement) => (
        <EntitlementCard
          key={entitlement.entitlementId}
          entitlement={entitlement}
          wallets={wallets}
          walletsLoading={isBalanceLoading}
          onChanged={refresh}
        />
      ))}
    </div>
  );

  return (
    <MainLayout>
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold">Inbox</h1>
            <p className="mt-1 text-muted-foreground">Your own claims only</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refresh()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {!configured ? (
          <NomineDisclosure tone="warning" title="Claiming is not configured" className="mb-6">
            This deployment is missing its claim contract configuration, so claiming is disabled.
          </NomineDisclosure>
        ) : null}

        {error ? (
          <NomineDisclosure tone="warning" className="mb-6" title="Could not load inbox">
            {error}
          </NomineDisclosure>
        ) : null}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4 text-accent" /> Loading your claims…
          </div>
        ) : isEmpty ? (
          // A failed fetch is not an empty inbox, so the empty state never stands in for an error.
          error ? null : <EmptyInbox email={user?.email} />
        ) : (
          <>
            {grouping.available.length > 0 ? (
              <section className="mb-8">
                <div className="mb-3 flex items-center gap-2">
                  <Gift className="h-5 w-5 text-accent" />
                  <h2 className="font-display text-xl font-semibold">Available</h2>
                  <span className="text-sm text-muted-foreground">
                    ({grouping.available.length})
                  </span>
                </div>
                {renderGroup(grouping.available)}
              </section>
            ) : null}

            {grouping.completed.length > 0 ? (
              <section className="mb-8">
                <div className="mb-3 flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-success" />
                  <h2 className="font-display text-xl font-semibold">Completed</h2>
                  <span className="text-sm text-muted-foreground">
                    ({grouping.completed.length})
                  </span>
                </div>
                {renderGroup(grouping.completed)}
              </section>
            ) : null}

            {grouping.expired.length > 0 ? (
              <section className="mb-8">
                <div className="mb-3 flex items-center gap-2">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <h2 className="font-display text-xl font-semibold">Expired</h2>
                  <span className="text-sm text-muted-foreground">
                    ({grouping.expired.length})
                  </span>
                </div>
                {renderGroup(grouping.expired)}
              </section>
            ) : null}
          </>
        )}
      </div>
    </MainLayout>
  );
}
