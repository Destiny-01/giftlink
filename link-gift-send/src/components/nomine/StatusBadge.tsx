/**
 * Nomine status badges.
 *
 * Two vocabularies:
 *  - lifecycle: the three claimant-facing groups (Available / Completed / Expired)
 *  - request:   the off-chain workflow status of a ClaimRequest
 * plus campaign funding status. Copy matches spec §7 exactly.
 */

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RecipientStatus } from "@/lib/campaignRecipients";
import type {
  CampaignStatus,
  ClaimRequestStatus,
  LifecycleGroup,
  WorkflowState,
} from "@/types/nomine";

type Kind = "lifecycle" | "request" | "workflow" | "campaign" | "recipient";

interface Variant {
  label: string;
  className: string;
}

const PENDING = "bg-muted-foreground/20 text-muted-foreground border-muted-foreground/30";
const ATTN = "bg-accent/20 text-accent border-accent/30";
const SUCCESS = "bg-success/20 text-success border-success/30";
const DANGER = "bg-danger/20 text-danger border-danger/30";
const NEUTRAL = "bg-muted text-muted-foreground border-muted";

const LIFECYCLE: Record<LifecycleGroup, Variant> = {
  AVAILABLE: { label: "Available", className: ATTN },
  COMPLETED: { label: "Completed", className: SUCCESS },
  EXPIRED: { label: "Expired", className: NEUTRAL },
};

const REQUEST: Record<ClaimRequestStatus, Variant> = {
  CONSENTED: { label: "Awaiting issuer confirmation", className: ATTN },
  ISSUER_APPROVED: {
    label: "Sending your USDC",
    className: PENDING,
  },
  SUBMITTED: { label: "Sending your USDC", className: PENDING },
  SETTLED: { label: "Paid", className: SUCCESS },
  FAILED: { label: "Something went wrong", className: DANGER },
  EXPIRED: { label: "Expired", className: NEUTRAL },
};

const WORKFLOW: Record<WorkflowState, Variant> = {
  AWAITING_ISSUER: { label: "Awaiting issuer confirmation", className: ATTN },
  AWAITING_RESOLVER: {
    label: "Sending your USDC",
    className: PENDING,
  },
  PENDING_SUBMISSION: { label: "Sending your USDC", className: PENDING },
};

const CAMPAIGN: Record<CampaignStatus, Variant> = {
  DRAFT: { label: "Draft", className: PENDING },
  FUNDED: { label: "Funded", className: SUCCESS },
  RECLAIMED: { label: "Reclaimed", className: NEUTRAL },
};

/** The issuer's per-recipient view: the four states a payout row can be in. */
const RECIPIENT: Record<RecipientStatus, Variant> = {
  NOT_CLAIMED: { label: "Not claimed", className: NEUTRAL },
  CLAIMING: { label: "Claiming", className: ATTN },
  PAID: { label: "Paid", className: SUCCESS },
  EXPIRED: { label: "Expired", className: NEUTRAL },
};

interface NomineStatusBadgeProps {
  value: LifecycleGroup | ClaimRequestStatus | WorkflowState | CampaignStatus | string;
  kind: Kind;
  className?: string;
}

export function NomineStatusBadge({ value, kind, className }: NomineStatusBadgeProps) {
  const table =
    kind === "lifecycle"
      ? LIFECYCLE
      : kind === "request"
      ? REQUEST
      : kind === "workflow"
      ? WORKFLOW
      : kind === "recipient"
      ? RECIPIENT
      : CAMPAIGN;

  const variant = (table as Record<string, Variant>)[value] ?? {
    label: value,
    className: PENDING,
  };

  return (
    <Badge variant="outline" className={cn(variant.className, className)}>
      {variant.label}
    </Badge>
  );
}

/** A generic label chip used for things like "Opens <date>" or "Direct USDC payout". */
export function NomineChip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground",
        className
      )}
    >
      {children}
    </span>
  );
}
