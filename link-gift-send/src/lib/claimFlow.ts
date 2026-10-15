/**
 * Claimant claim state: the one-click step machine plus the pure view derivations it drives.
 *
 * The claimant presses a single button and the app drives the whole round-trip: sign consent,
 * post it, and - when the backend answered with an issuer-approved request rather than a settled
 * one - trigger the sponsored settlement exactly once. Keeping this as pure functions with the
 * side effects injected (sign, settle) is what makes it testable without a browser or a wallet.
 *
 * Only a `SETTLED` request (or a verified receipt) is ever reported as done. A signed request, a
 * submitted transaction hash, or a timeout is not settlement.
 *
 * Pure: type-only imports here are erased by the runtime, so this module executes under
 * `node --test` with no bundler and no aliases.
 */

import type {
  ClaimRequestStatus,
  ClaimRequestView,
  NomineEntitlement,
  SettlementReceipt,
} from "@/types/nomine";

export type ClaimStep =
  /** Nothing has happened yet. */
  | "idle"
  /** Signing consent with the claimant's wallet. */
  | "preparing"
  /** Consent posted; the sponsored payout is being submitted and polled. */
  | "sending"
  /** Consent posted on a manual campaign; a human issuer must confirm. */
  | "waiting"
  /** Verified settlement. Terminal. */
  | "settled"
  /** The payout could not be completed. Recoverable. */
  | "failed";

export type ClaimOutcome = "settled" | "waiting" | "sending" | "failed";

export interface ClaimFlowDeps {
  /** Sign consent and post it. Resolves with the resulting request. */
  signConsent: () => Promise<ClaimRequestView>;
  /** Trigger the sponsored settlement and poll it to a terminal state. */
  settle: (signedRequest: ClaimRequestView) => Promise<ClaimRequestView | null>;
  /** Observes every step transition, for button labels and progress copy. */
  onStep?: (step: ClaimStep) => void;
}

export interface ClaimFlowResult {
  step: ClaimStep;
  outcome: ClaimOutcome;
  request: ClaimRequestView | null;
  error: string | null;
}

/** A verified settlement, and nothing else, is done. */
export function isSettled(request?: ClaimRequestView | null): boolean {
  if (!request) return false;
  return request.status === "SETTLED" || Boolean(request.receipt);
}

/** Terminal request statuses: polling stops. */
export function isTerminal(request?: ClaimRequestView | null): boolean {
  if (!request) return false;
  return (
    request.status === "SETTLED" ||
    request.status === "FAILED" ||
    request.status === "EXPIRED"
  );
}

/**
 * Which request the payout should be retried for.
 *
 * A retry must work for a request this session just created, not only for one the server already
 * listed: after a 60s poll timeout or a payout failure the entitlement still carries no request, so
 * the flow's own request is the only thing that knows the id. Without this fallback "Retry payout"
 * is a dead end for exactly the claims that need it.
 */
export function resolveRequestId(
  serverRequest?: ClaimRequestView | null,
  flowRequest?: ClaimRequestView | null
): string | null {
  return serverRequest?.id ?? flowRequest?.id ?? null;
}

/** How far a request has progressed. Higher wins when two views of it disagree. */
function requestRank(request?: ClaimRequestView | null): number {
  if (!request) return -1;
  if (
    request.status === "SETTLED" ||
    request.status === "FAILED" ||
    request.status === "EXPIRED"
  ) {
    return 2;
  }
  if (request.status === "ISSUER_APPROVED" || request.status === "SUBMITTED") return 1;
  return 0;
}

/**
 * Which request to render when a locally cached flow result and a freshly polled server request
 * disagree.
 *
 * The local result must not win forever. On a manual campaign the flow caches `CONSENTED`; when the
 * issuer later approves, the poll delivers `ISSUER_APPROVED`, and keeping the cached `CONSENTED`
 * would show "Waiting for the issuer…" with no button and no way to settle for the rest of the
 * session. The more advanced state wins; a tie keeps the local result, which carries the freshest
 * detail (the receipt from the settle response, or a `settleError`).
 */
export function pickCurrentRequest(
  serverRequest?: ClaimRequestView | null,
  flowRequest?: ClaimRequestView | null
): ClaimRequestView | null {
  if (!flowRequest) return serverRequest ?? null;
  if (!serverRequest) return flowRequest;
  return requestRank(serverRequest) > requestRank(flowRequest)
    ? serverRequest
    : flowRequest;
}

/**
 * The verified settlement to display for an entitlement: the request's receipt when it has one,
 * otherwise one reconstructed from the entitlement's own settlement hash. That hash is itself only
 * ever set from a verified `Settlement` event, so a completed item always keeps its explorer link.
 */
export function settlementReceiptFor(
  entitlement: NomineEntitlement
): SettlementReceipt | null {
  if (entitlement.request?.receipt) return entitlement.request.receipt;
  if (!entitlement.settlementTxHash) return null;
  return {
    campaignId: entitlement.campaignId,
    entitlementId: entitlement.entitlementId,
    wallet: entitlement.claimantAddress ?? "",
    amount: entitlement.amount,
    txHash: entitlement.settlementTxHash,
    sponsored: true,
  };
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Drive one claim attempt. Returns the state the UI should render; never throws, because a failed
 * attempt must become visible copy (and a retry), not an unhandled rejection.
 */
export async function runClaimFlow(deps: ClaimFlowDeps): Promise<ClaimFlowResult> {
  const emit = deps.onStep ?? (() => {});

  emit("preparing");

  let signed: ClaimRequestView;
  try {
    signed = await deps.signConsent();
  } catch (error: unknown) {
    emit("failed");
    return {
      step: "failed",
      outcome: "failed",
      request: null,
      error: messageOf(error, "We couldn't complete your claim. Please try again."),
    };
  }

  if (isSettled(signed)) {
    emit("settled");
    return { step: "settled", outcome: "settled", request: signed, error: null };
  }

  // The backend settles automatically for auto campaigns and reports a payout failure on the
  // consent response instead of a settled receipt. Retrying immediately would just repeat it, so
  // this is surfaced honestly for the claimant to retry deliberately.
  if (signed.settleError) {
    emit("failed");
    return {
      step: "failed",
      outcome: "failed",
      request: signed,
      error: signed.settleError.message,
    };
  }

  // A manual campaign holds the request until a human issuer confirms it. There is nothing to
  // settle yet, and polling for one would be dishonest.
  if (signed.status === "CONSENTED") {
    emit("waiting");
    return { step: "waiting", outcome: "waiting", request: signed, error: null };
  }

  if (signed.status === "ISSUER_APPROVED" || signed.status === "SUBMITTED") {
    emit("sending");

    let settled: ClaimRequestView | null;
    try {
      settled = await deps.settle(signed);
    } catch (error: unknown) {
      emit("failed");
      return {
        step: "failed",
        outcome: "failed",
        request: signed,
        error: messageOf(error, "The payout could not be submitted. You can retry."),
      };
    }

    const latest = settled ?? signed;
    if (isSettled(latest)) {
      emit("settled");
      return { step: "settled", outcome: "settled", request: latest, error: null };
    }
    if (latest.status === "FAILED" || latest.status === "EXPIRED") {
      emit("failed");
      return {
        step: "failed",
        outcome: "failed",
        request: latest,
        error: latest.failureReason ?? "Something went wrong. You can try again.",
      };
    }
    // Still in flight after the polling window: report it rather than claiming success.
    return { step: "sending", outcome: "sending", request: latest, error: null };
  }

  if (signed.status === "FAILED") {
    emit("failed");
    return {
      step: "failed",
      outcome: "failed",
      request: signed,
      error: signed.failureReason ?? "Something went wrong. You can try again.",
    };
  }

  // Anything else (including an unexpected EXPIRED consent response): keep the request visible.
  emit("waiting");
  return { step: "waiting", outcome: "waiting", request: signed, error: null };
}

/** The plain-language headline for a request state, per the claimant copy table. */
export function describeClaimStatus(
  status: ClaimRequestStatus | null | undefined,
  issuerName?: string | null
): string {
  switch (status) {
    case "CONSENTED":
      return `Waiting for ${issuerName || "the issuer"} to confirm your claim.`;
    case "ISSUER_APPROVED":
    case "SUBMITTED":
      return "Sending your USDC…";
    case "SETTLED":
      return "Paid";
    case "FAILED":
      return "Something went wrong";
    case "EXPIRED":
      return "This claim has expired";
    default:
      return "";
  }
}
