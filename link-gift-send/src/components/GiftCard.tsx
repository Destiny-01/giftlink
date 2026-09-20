/**
 * Gift card component - displays a single gift
 */

import { useState } from "react";
import { MoreVertical, Copy, Edit, Trash2, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "./StatusBadge";
import { Badge } from "@/components/ui/badge";
import { useClipboard } from "@/hooks/useClipboard";
import type { Gift } from "@/types/gift";

interface GiftCardProps {
  gift: Gift;
  onRevoke?: (id: string) => void;
  onEdit?: (id: string) => void;
  onClick?: () => void;
}

export function GiftCard({ gift, onRevoke, onEdit, onClick }: GiftCardProps) {
  const { copyToClipboard } = useClipboard();
  const [isExpanded, setIsExpanded] = useState(false);

  const handleCopyLink = () => {
    const link = `${window.location.origin}/claim/${gift.id}`;
    copyToClipboard(link, "Claim link copied!");
  };

  const canRevoke =
    (gift.status === "pending" || gift.status === "active") &&
    !gift.claimed &&
    gift.onchainId !== undefined;

  const canEdit =
    (gift.status === "pending" || gift.status === "active") &&
    gift.recipientType !== "public" &&
    onEdit !== undefined;

  return (
    <Card
      className="group relative cursor-pointer border border-white/[0.04] bg-card p-4 transition-all hover:-translate-y-1 hover:border-accent/20 hover:shadow-[0_6px_30px_rgba(1,8,16,0.6),0_0_20px_rgba(0,255,209,0.1)]"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3">
          {/* Header */}
          <div className="flex items-center gap-2">
            <StatusBadge status={gift.status} />
            {gift.recipientType === "public" && (
              <Badge
                variant="outline"
                className="border-accent/20 text-accent text-xs"
              >
                Public
              </Badge>
            )}
            {gift.recipientType && gift.recipientType !== "public" && (
              <Badge variant="outline" className="text-xs">
                Targeted
              </Badge>
            )}
          </div>

          {/* Amount */}
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-3xl font-bold">
                {parseFloat(gift.amount).toFixed(2)}
              </span>
              <span className="text-lg text-muted-foreground">USDC</span>
            </div>
          </div>

          {/* Message */}
          {gift.message && (
            <p className="text-sm text-foreground/80 line-clamp-2">
              {gift.message}
            </p>
          )}

          {/* Recipient/Sender info */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {gift.recipientIdentifier && (
              <span>To: {gift.recipientIdentifier}</span>
            )}
            {gift.claimedByName && (
              <span>Claimed by: {gift.claimedByName}</span>
            )}
            {gift.createdAt && (
              <span>
                {new Date(gift.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
            {gift.expiryAt && (
              <span>
                Expires:{" "}
                {new Date(gift.expiryAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            )}
          </div>
        </div>

        {/* Actions menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            {gift.status !== "claimed" && (
              <DropdownMenuItem onClick={handleCopyLink}>
                <Copy className="mr-2 h-4 w-4" />
                Copy Link
              </DropdownMenuItem>
            )}
            {gift.claimTxHash && (
              <DropdownMenuItem asChild>
                <a
                  href={`https://testnet.arcscan.app/tx/${gift.claimTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View on Explorer
                </a>
              </DropdownMenuItem>
            )}
            {canEdit && onEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onEdit(gift.id)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit Receiver
                </DropdownMenuItem>
              </>
            )}
            {canRevoke && onRevoke && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onRevoke(gift.onchainId)}
                  className="text-danger"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Revoke
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  );
}
