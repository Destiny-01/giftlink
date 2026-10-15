/**
 * useNomineInbox - claimant-side inbox and request status polling.
 *
 * Only a verified `Settlement` event consumes an entitlement. A signed request or a transaction hash
 * is not settlement, so `Completed` is never inferred client-side from anything but the backend's
 * verified receipt. The one-click claim action itself lives in `useOneClickClaim`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/services/api";
import type {
  CampaignGrouping,
  ClaimRequestView,
  NomineEntitlement,
  WorkflowState,
} from "@/types/nomine";

/** Map an off-chain request status to the workflow state shown inside Available. */
export function workflowStateFor(
  request?: ClaimRequestView | null
): WorkflowState | null {
  if (!request) return null;
  switch (request.status) {
    case "CONSENTED":
      return "AWAITING_ISSUER";
    case "ISSUER_APPROVED":
      return "AWAITING_RESOLVER";
    case "SUBMITTED":
      return "PENDING_SUBMISSION";
    default:
      return null;
  }
}

/** True when the entitlement should be treated as consumed (verified Settlement only). */
export function isConsumed(entitlement: NomineEntitlement): boolean {
  return (
    entitlement.status === "COMPLETED" ||
    entitlement.request?.status === "SETTLED" ||
    Boolean(entitlement.consumedAt)
  );
}

/** Group entitlements into the three claimant-facing lifecycle groups. */
export function groupEntitlements(
  entitlements: NomineEntitlement[]
): CampaignGrouping {
  const now = Math.floor(Date.now() / 1000);
  const grouping: CampaignGrouping = {
    available: [],
    completed: [],
    expired: [],
    preOpening: [],
  };

  for (const entitlement of entitlements) {
    if (isConsumed(entitlement)) {
      grouping.completed.push(entitlement);
      continue;
    }
    if (entitlement.status === "EXPIRED") {
      grouping.expired.push(entitlement);
      continue;
    }
    // Available (funded, unconsumed, not expired).
    grouping.available.push(entitlement);
    const opensAt = entitlement.opensAt ?? entitlement.campaign?.openingTime;
    if (opensAt && now < opensAt) {
      grouping.preOpening.push(entitlement);
    }
  }

  return grouping;
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------
export function useNomineInbox(options?: { pollMs?: number; enabled?: boolean }) {
  const pollMs = options?.pollMs ?? 30000;
  // Public surfaces (the campaign link before sign-in) must not call an authenticated endpoint.
  const enabled = options?.enabled ?? true;
  const [entitlements, setEntitlements] = useState<NomineEntitlement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setError(null);
    try {
      const data = await api.getNomineInbox();
      setEntitlements(data?.entitlements ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load your inbox");
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!pollMs || !enabled) return;
    const handle = setInterval(() => {
      refresh();
    }, pollMs);
    return () => clearInterval(handle);
  }, [pollMs, enabled, refresh]);

  const grouping = useMemo(() => groupEntitlements(entitlements), [entitlements]);

  return { entitlements, grouping, isLoading, error, refresh };
}

// ---------------------------------------------------------------------------
// Single request status (polls until terminal)
// ---------------------------------------------------------------------------
export function useClaimRequestStatus(
  campaignId?: string,
  requestId?: string,
  options?: { pollMs?: number }
) {
  const pollMs = options?.pollMs ?? 8000;
  const [request, setRequest] = useState<ClaimRequestView | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!campaignId || !requestId) return null;
    setError(null);
    setIsLoading(true);
    try {
      const data = await api.getNomineClaimRequest(campaignId, requestId);
      setRequest(data?.request ?? null);
      return data?.request ?? null;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load request");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [campaignId, requestId]);

  useEffect(() => {
    if (!campaignId || !requestId) return;
    refresh();
  }, [campaignId, requestId, refresh]);

  useEffect(() => {
    if (!campaignId || !requestId || !pollMs) return;
    const handle = setInterval(async () => {
      const latest = await refresh();
      if (latest && (latest.status === "SETTLED" || latest.status === "FAILED")) {
        clearInterval(handle);
      }
    }, pollMs);
    return () => clearInterval(handle);
  }, [campaignId, requestId, pollMs, refresh]);

  return { request, isLoading, error, refresh };
}
