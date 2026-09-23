/**
 * Claim gift page
 */

import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ExternalLink, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/StatusBadge";
import { useClaimDrop, useClaimDropPrivy } from "@/hooks/useCreateDrop";
import { useArcClient } from "@/hooks/useArcClient"; // Keep for getDropById utility
import { useAuth } from "@/hooks/useAuth";
import { useWallets } from "@privy-io/react-auth";
import { useConfetti } from "@/hooks/useConfetti";
import { FullPageLoader, Spinner } from "@/components/Loader";
import { toast } from "@/hooks/use-toast";
import type { Gift } from "@/types/gift";

export default function Claim() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated, connectWallet } = useAuth();
  const { wallets } = useWallets();
  const { getDropById, isLoading } = useArcClient();
  const claimDropExternal = useClaimDrop();
  const claimDropPrivy = useClaimDropPrivy();
  const { fireConfetti } = useConfetti();

  const [gift, setGift] = useState<Gift | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);

  const loadGift = useCallback(async () => {
    if (!id) return;
    const data = await getDropById(id);
    setGift(data);
  }, [id, getDropById]);

  useEffect(() => {
    if (id) {
      loadGift();
    }
  }, [id, loadGift]);

  const handleClaim = async () => {
    if (!isAuthenticated || !user?.address) {
      connectWallet();
      return;
    }

    if (!gift || !id) return;

    if (!gift.onchainId) {
      toast({
        title: "Cannot claim",
        description: "On-chain ID is missing. Cannot claim this gift.",
        variant: "destructive",
      });
      return;
    }

    setClaiming(true);

    try {
      const hasPrivyWallet = wallets.some(
        (w) =>
          w.address?.toLowerCase() === user.address?.toLowerCase() &&
          w.walletClientType === "privy"
      );

      const isPublic = !gift.recipientType || gift.recipientType === "public";
      const claimDropHook = hasPrivyWallet ? claimDropPrivy : claimDropExternal;

      const result = await claimDropHook.claimDrop(
        gift.id,
        gift.onchainId,
        isPublic
      );

      if (result?.txHash) {
        setClaimed(true);
        fireConfetti();
        toast({
          title: "Success! 🎉",
          description: `${gift.amount} USDC claimed and added to your wallet`,
        });

        setTimeout(() => loadGift(), 1000);
      }
    } catch (error: unknown) {
      console.error("Failed to claim:", error instanceof Error ? error.message : "Unknown error");
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Could not claim the gift. Please try again.";
      toast({
        title: "Failed to claim",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setClaiming(false);
    }
  };

  if (isLoading && !gift) {
    return <FullPageLoader />;
  }

  if (!gift) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md border border-white/[0.04] bg-card p-8 text-center">
          <h2 className="mb-2 font-display text-2xl font-bold">
            Gift Not Found
          </h2>
          <p className="mb-6 text-muted-foreground">
            This gift link is invalid or has expired
          </p>
          <Button onClick={() => navigate("/")}>Return Home</Button>
        </Card>
      </div>
    );
  }

  const isExpired = gift.expiryAt && new Date(gift.expiryAt) < new Date();
  const isTargeted = gift.recipientType && gift.recipientType !== "public";
  const canClaim = gift.canClaim ?? false;
  const isClaimedByCurrentUser =
    user?.address &&
    gift.claimedBy &&
    user.address.toLowerCase() === gift.claimedBy.toLowerCase();

  if (gift.status === "claimed" && !claimed && !isClaimedByCurrentUser) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="container mx-auto max-w-2xl py-8">
          <Button
            variant="ghost"
            className="mb-6"
            onClick={() => navigate("/")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Home
          </Button>

          <Card className="relative p-8 text-center overflow-hidden border border-white/[0.04] bg-card">
            <div className="mb-4 text-5xl">✅</div>
            <h2 className="mb-2 font-display text-2xl font-bold">
              This Drop Has Been Claimed
            </h2>
            <p className="mb-6 text-muted-foreground">
              {gift.claimedByName
                ? `Claimed by ${gift.claimedByName}`
                : "This gift has already been claimed"}
              {gift.claimTxHash && (
                <a
                  href={`https://testnet.arcscan.app/tx/${gift.claimTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 inline-flex items-center gap-1 text-accent hover:underline"
                >
                  View transaction
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </p>
            <Button onClick={() => navigate("/")}>Return Home</Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="container mx-auto max-w-2xl py-8">
        <Button variant="ghost" className="mb-6" onClick={() => navigate("/")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Home
        </Button>

        <Card className="relative overflow-hidden border border-white/[0.04] bg-card">
          {/* Header gradient */}
          <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-accent/10 to-transparent" />

          <div className="relative p-8">
            {/* Status banner */}
            {isAuthenticated && (
              <div className="mb-6 flex flex-wrap items-center gap-2">
                <StatusBadge status={gift.status} />
                {isTargeted && (
                  <span className="rounded-full border border-accent/20 bg-accent/5 px-3 py-1 text-xs font-medium text-accent">
                    Targeted
                  </span>
                )}
              </div>
            )}

            {(!isTargeted || canClaim) && (
              <>
                {/* Sender info */}
                <div className="mb-6 flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="bg-accent/20 text-accent">
                      {gift.senderName?.[0] ||
                        gift.sender.slice(2, 4).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold">
                      {gift.senderName ||
                        `${gift.sender.slice(0, 6)}...${gift.sender.slice(-4)}`}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      sent you a gift
                    </p>
                  </div>
                </div>

                {/* Message */}
                {gift.message && (
                  <div className="mb-6 rounded-lg border border-white/[0.04] bg-surface/50 p-4">
                    <p className="text-sm font-medium text-muted-foreground">
                      Message
                    </p>
                    <p className="mt-1">{gift.message}</p>
                  </div>
                )}

                {/* Amount - Large display */}
                <div className="mb-8 text-center">
                  <div className="flex items-baseline justify-center gap-3">
                    <span className="font-display text-6xl font-bold tracking-tight">
                      {parseFloat(gift.amount).toFixed(2)}
                    </span>
                    <span className="text-3xl font-semibold text-muted-foreground">
                      USDC
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* Expired state */}
            {isExpired && (
              <div className="mb-6 rounded-lg border border-danger/20 bg-danger/5 p-4 text-center">
                <p className="text-sm">
                  <strong>This gift has expired</strong>
                  <br />
                  <span className="text-muted-foreground">
                    Expired on {new Date(gift.expiryAt!).toLocaleDateString()}
                  </span>
                </p>
              </div>
            )}

            {/* Targeted gift info or mismatch message */}
            {isTargeted && gift.recipientIdentifier && (
              <div
                className={`mb-6 rounded-lg border p-4 text-center ${
                  canClaim
                    ? "border-accent/20 bg-accent/5"
                    : "border-warning/20 bg-warning/5"
                }`}
              >
                {canClaim ? (
                  <p className="text-sm">
                    This gift is reserved for{" "}
                    <strong>{gift.recipientIdentifier}</strong>
                  </p>
                ) : isAuthenticated ? (
                  <p className="text-sm">
                    <strong>This gift is not for you</strong>
                    <br />
                    <span className="text-muted-foreground">
                      This gift is reserved for{" "}
                      <strong>{gift.recipientIdentifier}</strong>
                    </span>
                  </p>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm">
                      This gift is reserved for{" "}
                      <strong>{gift.recipientIdentifier}</strong>
                      <br />
                      <span className="text-muted-foreground">
                        Sign in to verify if this gift is for you
                      </span>
                    </p>
                    <Button
                      size="lg"
                      className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                      onClick={connectWallet}
                    >
                      Sign in to Claim
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Claim button */}
            {canClaim && (
              <>
                {!isAuthenticated ? (
                  <Button
                    size="lg"
                    className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                    onClick={connectWallet}
                  >
                    Sign in to Claim
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
                    onClick={handleClaim}
                    disabled={
                      claiming ||
                      claimDropExternal.isLoading ||
                      claimDropPrivy.isLoading
                    }
                  >
                    {claiming ? (
                      <>
                        <Spinner className="mr-2 h-4 w-4" />
                        Claiming...
                      </>
                    ) : (
                      `Claim ${gift.amount} USDC`
                    )}
                  </Button>
                )}
              </>
            )}

            {(claimed ||
              (gift.status === "claimed" && isClaimedByCurrentUser)) && (
              <div className="mt-6 space-y-4 rounded-lg border border-success/20 bg-success/5 p-6 text-center">
                <div className="text-4xl">🎉</div>
                <div>
                  <h3 className="font-display text-xl font-bold">
                    Congratulations!
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {gift.amount} USDC has been added to your wallet
                  </p>
                  {gift.claimTxHash && (
                    <a
                      href={`https://testnet.arcscan.app/tx/${gift.claimTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-sm text-accent hover:underline"
                    >
                      View transaction
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <Button
                  variant="outline"
                  onClick={() => navigate("/dashboard")}
                >
                  View Dashboard
                </Button>
              </div>
            )}

            {canClaim && gift.expiryAt && (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Expires on{" "}
                {new Date(gift.expiryAt).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
