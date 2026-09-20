/**
 * Activity / History page
 */

import { useEffect, useState, useCallback } from "react";
import { MainLayout } from "@/components/MainLayout";
import { GiftCard } from "@/components/GiftCard";
import { EditReceiverDialog } from "@/components/EditReceiverDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { useArcClient } from "@/hooks/useArcClient";
import { SkeletonCard } from "@/components/Loader";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import type { Gift } from "@/types/gift";
import { useNavigate } from "react-router-dom";

export default function Activity() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { getUserDrops, isLoading, revokeDrop, editReceiver } = useArcClient();
  const [sentGifts, setSentGifts] = useState<Gift[]>([]);
  const [receivedGifts, setReceivedGifts] = useState<Gift[]>([]);
  const [claimableGifts, setClaimableGifts] = useState<Gift[]>([]);
  const [editingGift, setEditingGift] = useState<Gift | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const loadGifts = useCallback(async () => {
    if (!user?.address) return;
    const data = await getUserDrops(user.address);
    setSentGifts(data.sent);
    setReceivedGifts(data.received);
    setClaimableGifts(data.claimable);
  }, [user?.address, getUserDrops]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/app");
      return;
    }

    if (user?.address) {
      loadGifts();
    }
  }, [user, authLoading, isAuthenticated, loadGifts, navigate]);

  const getGiftsForTab = (tab: string): Gift[] => {
    switch (tab) {
      case "sent":
        return sentGifts;
      case "received":
        return receivedGifts;
      case "claimable":
        return claimableGifts;
      case "active":
        return [...sentGifts, ...receivedGifts, ...claimableGifts].filter(
          (g) => g.status === "pending" || g.status === "active"
        );
      default:
        // "all" - combine all gifts
        return [...sentGifts, ...receivedGifts, ...claimableGifts];
    }
  };

  const handleRevoke = async (id: string) => {
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
    } else {
      toast({
        title: "Failed to revoke",
        description: "Could not revoke the gift. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleEdit = async (id: string) => {
    // Only allow editing sent gifts
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

  const renderGiftList = (tab: string) => {
    const gifts = getGiftsForTab(tab);

    if (isLoading) {
      return (
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      );
    }

    if (gifts.length === 0) {
      return (
        <Card className="border border-white/[0.04] bg-card p-12 text-center">
          <p className="text-muted-foreground">No gifts found</p>
        </Card>
      );
    }

    return (
      <div className="space-y-4">
        {gifts.map((gift) => {
          const isSentGift = sentGifts.some((g) => g.id === gift.id);
          return (
            <GiftCard
              key={gift.id}
              gift={gift}
              onRevoke={isSentGift ? handleRevoke : undefined}
              onEdit={isSentGift ? handleEdit : undefined}
            />
          );
        })}
      </div>
    );
  };

  return (
    <MainLayout>
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold">
            Activity & History
          </h1>
          <p className="mt-2 text-muted-foreground">
            View all your sent and received gifts
          </p>
        </div>

        <Tabs defaultValue="all" className="space-y-6">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="sent">Sent</TabsTrigger>
            <TabsTrigger value="received">Received</TabsTrigger>
            <TabsTrigger value="claimable">Claimable</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
          </TabsList>

          <TabsContent value="all">{renderGiftList("all")}</TabsContent>

          <TabsContent value="sent">{renderGiftList("sent")}</TabsContent>

          <TabsContent value="received">
            {renderGiftList("received")}
          </TabsContent>

          <TabsContent value="claimable">
            {renderGiftList("claimable")}
          </TabsContent>

          <TabsContent value="active">{renderGiftList("active")}</TabsContent>
        </Tabs>

        <EditReceiverDialog
          gift={editingGift}
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          onSuccess={handleEditSuccess}
          onEdit={handleEditReceiver}
        />
      </div>
    </MainLayout>
  );
}
