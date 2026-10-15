/**
 * useOneClickClaim - the single claim action.
 *
 * Wraps the pure step machine in `lib/claimFlow` with the two real side effects: signing consent
 * through `useClaimConsent`, and the sponsored settlement plus its 3s/60s poll. The UI only has to
 * read `step`, `request` and `error`.
 *
 * Polling stops at a terminal request status, and a timeout is reported as "still sending" rather
 * than as success - a submitted hash is not a settlement.
 */

import { useCallback, useRef, useState } from "react";
import * as api from "@/services/api";
import { useClaimConsent } from "@/hooks/useClaimConsent";
import { isTerminal, resolveRequestId, runClaimFlow, type ClaimStep } from "@/lib/claimFlow";
import type {
  ClaimRequestView,
  NomineEntitlement,
  SigningWallet,
} from "@/types/nomine";

/** The claimant waits at most a minute for the sponsored payout before being offered a retry. */
const SETTLE_POLL_MS = 3000;
const SETTLE_TIMEOUT_MS = 60000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Submit the sponsored settlement, then poll until the request reaches a terminal state or the
 * window closes. Transient read errors are not failures; the relay is idempotent and safe to retry.
 */
async function settleAndPoll(
  campaignId: string,
  requestId: string
): Promise<ClaimRequestView | null> {
  const submitted = await api.sponsorNomineSettle(campaignId, requestId);
  let latest = submitted?.request ?? null;
  if (isTerminal(latest)) return latest;

  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(SETTLE_POLL_MS);
    try {
      const res = await api.getNomineClaimRequest(campaignId, requestId);
      latest = res?.request ?? latest;
      if (isTerminal(latest)) return latest;
    } catch {
      // Keep polling: a read failure is not a settlement failure.
    }
  }
  return latest;
}

export interface OneClickClaim {
  step: ClaimStep;
  request: ClaimRequestView | null;
  error: string | null;
  /** True while the flow is signing or submitting; the button is disabled during it. */
  isBusy: boolean;
  claim: (entitlement: NomineEntitlement, wallet: SigningWallet) => Promise<void>;
  retryPayout: (entitlement: NomineEntitlement) => Promise<void>;
}

export function useOneClickClaim(): OneClickClaim {
  const { signConsent } = useClaimConsent();
  const [step, setStep] = useState<ClaimStep>("idle");
  const [request, setRequestState] = useState<ClaimRequestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  /**
   * Mirrors `request` so `retryPayout` can reach the id of a request this session created without
   * taking `request` as a dependency (which would rebuild the callback on every poll result).
   */
  const requestRef = useRef<ClaimRequestView | null>(null);

  const setRequest = useCallback((next: ClaimRequestView | null) => {
    requestRef.current = next;
    setRequestState(next);
  }, []);

  const claim = useCallback(
    async (entitlement: NomineEntitlement, wallet: SigningWallet) => {
      setIsBusy(true);
      setError(null);
      setRequest(null);
      try {
        const result = await runClaimFlow({
          onStep: setStep,
          signConsent: async () => {
            const response = await signConsent({
              campaign: entitlement.campaign,
              entitlementId: entitlement.entitlementId,
              wallet,
              amount: entitlement.amount,
            });
            return response.request;
          },
          settle: (signed) => settleAndPoll(entitlement.campaignId, signed.id),
        });
        setRequest(result.request);
        setError(result.error);
        setStep(result.step);
      } finally {
        setIsBusy(false);
      }
    },
    [signConsent, setRequest]
  );

  const retryPayout = useCallback(
    async (entitlement: NomineEntitlement) => {
      const requestId = resolveRequestId(entitlement.request, requestRef.current);
      if (!requestId) {
        setStep("failed");
        setError("This claim has no request to settle yet.");
        return;
      }

      setIsBusy(true);
      setError(null);
      setStep("sending");
      try {
        const latest = await settleAndPoll(entitlement.campaignId, requestId);
        setRequest(latest);
        if (latest?.status === "SETTLED") {
          setStep("settled");
        } else if (latest?.status === "FAILED" || latest?.status === "EXPIRED") {
          setStep("failed");
          setError(latest.failureReason ?? "Something went wrong. You can try again.");
        } else {
          setStep("sending");
        }
      } catch (err: unknown) {
        setStep("failed");
        setError(
          err instanceof Error ? err.message : "The payout could not be submitted. You can retry."
        );
      } finally {
        setIsBusy(false);
      }
    },
    [setRequest]
  );

  return { step, request, error, isBusy, claim, retryPayout };
}
