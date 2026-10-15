/**
 * The issuer's recipient view: one row per recipient, joined from the two places the data lives.
 *
 * Nomine never returns addresses, and it cannot say who an approval request belongs to, so a row is
 * built from the issuer's own local record (entitlement identifier -> email, saved at prepare time)
 * joined with the live requests. Identifiers the issuer has no local record for are still shown -
 * with no email - rather than hidden, because an unresolved row is exactly the one that needs a
 * manual check before approval.
 *
 * Pure: type-only imports are erased at runtime, so this executes under `node --test`.
 */

import type { IssuerApprovalRequest } from "../types/nomine";
import type { RosterEntry } from "./issuerRoster";

export type RecipientStatus = "NOT_CLAIMED" | "CLAIMING" | "PAID" | "EXPIRED";

export interface RecipientRow {
  entitlementId: string;
  /** The address the issuer recorded locally, or null when this browser has no record. */
  email: string | null;
  status: RecipientStatus;
  /** The wallet the claimant signed with, once they have consented. */
  walletAddress: string | null;
  settlementTxHash: string | null;
  /** The live request for this identifier, when there is one - the approve action needs it. */
  request: IssuerApprovalRequest | null;
}

/** The four claimant-facing states the issuer sees, derived from the request and the window. */
export function recipientStatusFor(
  request: IssuerApprovalRequest | undefined,
  campaignExpired: boolean
): RecipientStatus {
  switch (request?.status) {
    case "SETTLED":
      return "PAID";
    // FAILED belongs with the in-flight states: nothing was consumed, so the payout can be retried.
    case "CONSENTED":
    case "ISSUER_APPROVED":
    case "SUBMITTED":
    case "FAILED":
      return "CLAIMING";
    case "EXPIRED":
      return "EXPIRED";
    default:
      return campaignExpired ? "EXPIRED" : "NOT_CLAIMED";
  }
}

/**
 * One row per recipient: every locally recorded identifier in the issuer's own order, then any
 * identifier the server knows about that the local record does not.
 */
export function buildRecipientRows(
  roster: RosterEntry[],
  requests: IssuerApprovalRequest[],
  options: { campaignExpired: boolean }
): RecipientRow[] {
  const requestById = new Map<string, IssuerApprovalRequest>();
  for (const request of requests) {
    requestById.set(request.entitlementId.toLowerCase(), request);
  }

  const rows: RecipientRow[] = [];
  const seen = new Set<string>();

  for (const entry of roster) {
    const key = entry.entitlementId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const request = requestById.get(key);
    rows.push({
      entitlementId: entry.entitlementId,
      email: entry.email,
      status: recipientStatusFor(request, options.campaignExpired),
      walletAddress: request?.walletAddress ?? null,
      settlementTxHash: request?.settlementTxHash ?? null,
      request: request ?? null,
    });
  }

  for (const request of requests) {
    const key = request.entitlementId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      entitlementId: request.entitlementId,
      email: null,
      status: recipientStatusFor(request, options.campaignExpired),
      walletAddress: request.walletAddress ?? null,
      settlementTxHash: request.settlementTxHash ?? null,
      request,
    });
  }

  return rows;
}

/**
 * How many entitlements are consumed. The server's own count wins when it is present; otherwise the
 * settled requests are counted, which is the same number derived from the data on hand.
 */
export function claimedCount(
  campaign: { consumedCount?: number | null; entitlementCount: number },
  requests: IssuerApprovalRequest[]
): number {
  if (typeof campaign.consumedCount === "number") {
    return Math.max(0, Math.min(campaign.consumedCount, campaign.entitlementCount));
  }
  return requests.filter((request) => request.status === "SETTLED").length;
}
