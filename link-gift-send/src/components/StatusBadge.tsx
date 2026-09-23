/**
 * Status badge component
 */

import { Badge } from "@/components/ui/badge";
import type { GiftStatus } from "@/types/gift";

interface StatusBadgeProps {
  status: GiftStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const variants = {
    pending: {
      className:
        "bg-muted-foreground/20 text-muted-foreground border-muted-foreground/30",
      label: "Pending",
    },
    claimed: {
      className: "bg-success/20 text-success border-success/30",
      label: "Claimed",
    },
    expired: {
      className: "bg-muted text-muted-foreground border-muted",
      label: "Expired",
    },
    revoked: {
      className: "bg-danger/20 text-danger border-danger/30",
      label: "Revoked",
    },
  };

  const variant = variants[status] || variants.pending;

  return (
    <Badge variant="outline" className={variant.className}>
      {variant.label}
    </Badge>
  );
}
