/**
 * Main dashboard page
 */

import { useEffect, useState, useCallback } from "react";
import { TrendingUp, Link as LinkIcon, CheckCircle } from "lucide-react";
import { MainLayout } from "@/components/MainLayout";
import { BalanceCard } from "@/components/BalanceCard";
import { CreateGiftCard } from "@/components/CreateGiftCard";
import { GiftCard } from "@/components/GiftCard";
import { EditReceiverDialog } from "@/components/EditReceiverDialog";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useArcClient } from "@/hooks/useArcClient";
import { useAggregateBalance } from "@/hooks/useAggregateBalance";
import { SkeletonCard } from "@/components/Loader";
import { toast } from "@/hooks/use-toast";
import type { Gift } from "@/types/gift";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { getUserDrops, isLoading, error, revokeDrop, editReceiver } =
    useArcClient();
  const {
    balance: aggregateBalance,
    isLoading: isBalanceLoading,
    refresh: refreshBalance,
  } = useAggregateBalance();
  const [sentGifts, setSentGifts] = useState<Gift[]>([]);
  const [receivedGifts, setReceivedGifts] = useState<Gift[]>([]);
  const [claimableGifts, setClaimableGifts] = useState<Gift[]>([]);
  const [editingGift, setEditingGift] = useState<Gift | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const loadGifts = useCallback(async () => {
    if (!user?.address) return;
    const data = await getUserDrops(user.address);
    setSentGifts(data.sent || []);
    setReceivedGifts(data.received || []);
    setClaimableGifts(data.claimable || []);
  }, [user?.address, getUserDrops]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/app?next=/dashboard");
      return;
    }

    if (user?.address) {
      loadGifts();
    }
  }, [user, authLoading, isAuthenticated, loadGifts, navigate]);

  useEffect(() => {
    if (error) {
      toast({
        title: "Error",
        description: error,
        variant: "destructive",
      });
    }
  }, [error]);

  const handleRevoke = async (id: string) => {
    // Find the gift being revoked to verify ownership
    const giftToRevoke = sentGifts.find((g) => g.onchainId === id);
    if (!giftToRevoke) {
      toast({
        title: "Cannot revoke",
        description: "You can only revoke gifts you sent",
        variant: "destructive",
      });
      return;
    }

    if (!giftToRevoke.onchainId) {
      toast({
        title: "Cannot revoke",
        description: "On-chain ID is missing. Cannot revoke this gift.",
        variant: "destructive",
      });
      return;
    }

    const success = await revokeDrop(id);
    if (success) {
      toast({
        title: "Gift revoked",
        description: "The gift has been successfully revoked",
      });
      loadGifts();
      // Refresh balance after revoking (funds returned to wallet)
      refreshBalance();
    } else {
      toast({
        title: "Failed to revoke",
        description: "Could not revoke the gift. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleEdit = async (id: string) => {
    // Find the gift to edit
    const giftToEdit = sentGifts.find((g) => g.id === id);
    if (giftToEdit) {
      setEditingGift(giftToEdit);
      setIsEditDialogOpen(true);
    }
  };

  const handleEditSuccess = () => {
    loadGifts();
  };

  const handleEditReceiver = async (
    id: string,
    newRecipientIdentifier: string,
    newRecipientType: string
  ) => {
    return await editReceiver(id, newRecipientIdentifier, newRecipientType);
  };

  // Combine all gifts for display
  const allGifts = [...sentGifts, ...receivedGifts, ...claimableGifts];

  const stats = {
    activeLinks: allGifts.filter(
      (g) => g.status === "pending" || g.status === "active"
    ).length,
    claimedToday: allGifts.filter(
      (g) => g.claimed && isToday(g.claimedBy ? new Date() : null)
    ).length,
    totalSent: sentGifts
      .reduce((sum, g) => sum + parseFloat(g.amount || "0"), 0)
      .toFixed(2),
  };

  return (
    <MainLayout>
      <div className="container mx-auto px-4 py-8">
        {/* Hero section */}
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold sm:text-4xl">
            Welcome back{user?.name ? `, ${user.name}` : ""}
          </h1>
          <p className="mt-2 text-muted-foreground">
            Manage your gifts and create new ones
          </p>
        </div>

        {/* Top cards */}
        <div className="mb-8 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <BalanceCard
              balance={aggregateBalance}
              isLoading={isBalanceLoading}
            />
          </div>
          <div>
            <CreateGiftCard />
          </div>
        </div>

        {/* Main content grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Activity feed */}
          <div className="lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-2xl font-semibold">
                Recent Activity
              </h2>
              <button
                onClick={() => navigate("/activity")}
                className="text-sm text-accent hover:underline"
              >
                View all
              </button>
            </div>

            <div className="space-y-4">
              {isLoading ? (
                <>
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </>
              ) : allGifts.length === 0 ? (
                <Card className="border border-white/[0.04] bg-card p-12 text-center">
                  <p className="text-muted-foreground">
                    No gifts yet. Create your first one!
                  </p>
                </Card>
              ) : (
                allGifts
                  .sort((a, b) => {
                    // Sort by creation date (newest first), or expiry date as fallback
                    const dateA = a.createdAt
                      ? new Date(a.createdAt).getTime()
                      : a.expiryAt
                      ? new Date(a.expiryAt).getTime()
                      : 0;
                    const dateB = b.createdAt
                      ? new Date(b.createdAt).getTime()
                      : b.expiryAt
                      ? new Date(b.expiryAt).getTime()
                      : 0;
                    return dateB - dateA;
                  })
                  .slice(0, 5)
                  .map((gift) => {
                    // Edit/revoke only available for sent gifts
                    const isSentGift = sentGifts.some((g) => g.id === gift.id);
                    return (
                      <GiftCard
                        key={gift.id}
                        gift={gift}
                        onRevoke={isSentGift ? handleRevoke : undefined}
                        onEdit={isSentGift ? handleEdit : undefined}
                        onClick={() => {
                          /* TODO: Open modal */
                        }}
                      />
                    );
                  })
              )}
            </div>
          </div>

          {/* Sidebar - Stats & Quick Actions */}
          <div className="space-y-6">
            {/* Stats */}
            <Card className="border border-white/[0.04] bg-card p-6">
              <h3 className="mb-4 font-display text-lg font-semibold">
                Quick Stats
              </h3>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted-foreground/20">
                    <LinkIcon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stats.activeLinks}</p>
                    <p className="text-xs text-muted-foreground">
                      Active Links
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/20">
                    <CheckCircle className="h-5 w-5 text-success" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stats.claimedToday}</p>
                    <p className="text-xs text-muted-foreground">
                      Claimed Today
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/20">
                    <TrendingUp className="h-5 w-5 text-accent" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stats.totalSent}</p>
                    <p className="text-xs text-muted-foreground">
                      Total Sent (USDC)
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            {/* How it works */}
            <Card className="border border-white/[0.04] bg-card p-6">
              <h3 className="mb-4 font-display text-lg font-semibold">
                How it works
              </h3>
              <ol className="space-y-3 text-sm text-muted-foreground">
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-accent">
                    1
                  </span>
                  <span>Create a gift with USDC and optional message</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-accent">
                    2
                  </span>
                  <span>Share the secure claim link via any channel</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-accent">
                    3
                  </span>
                  <span>Recipient claims instantly — gas paid in USDC</span>
                </li>
              </ol>
            </Card>
          </div>
        </div>
      </div>

      {/* Edit Receiver Dialog */}
      <EditReceiverDialog
        gift={editingGift}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        onSuccess={handleEditSuccess}
        onEdit={handleEditReceiver}
      />
    </MainLayout>
  );
}

function isToday(date: Date | null): boolean {
  if (!date) return false;
  const today = new Date();
  return date.toDateString() === today.toDateString();
}
