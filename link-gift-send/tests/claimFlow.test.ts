/**
 * Runtime tests for the one-click claim step machine.
 *
 * The behaviour that matters is a single button reaching the right outcome: a settled consent
 * response is done, an issuer-approved response is settled exactly once, and a manual consent is a
 * waiting state that never triggers a payout. Only a `SETTLED` request (or a verified receipt) may
 * ever be reported as done - a submitted hash or a timeout is not settlement.
 *
 * Run with: npm test  (node --test, TypeScript stripped natively)
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  describeClaimStatus,
  pickCurrentRequest,
  resolveRequestId,
  runClaimFlow,
  settlementReceiptFor,
} from "../src/lib/claimFlow.ts";
import type { ClaimRequestView, NomineEntitlement } from "../src/types/nomine.ts";

const BASE = {
  id: "req-1",
  campaignId: "campaign-1",
  entitlementId:
    "0x0000000000000000000000000000000000000000000000000000000000000001",
  walletAddress: "0x1111111111111111111111111111111111111111",
  amount: "300000",
  deadline: 1900000000,
} as const;

function request(status: string, extra: Record<string, unknown> = {}): ClaimRequestView {
  return { ...BASE, status, ...extra } as unknown as ClaimRequestView;
}

test("an auto settled response is done and never settles a second time", async () => {
  let settleCalls = 0;
  const steps: string[] = [];

  const result = await runClaimFlow({
    onStep: (step) => steps.push(step),
    signConsent: async () =>
      request("SETTLED", { receipt: { txHash: "0xdeadbeef" } }),
    settle: async () => {
      settleCalls += 1;
      return null;
    },
  });

  assert.equal(result.step, "settled");
  assert.equal(result.outcome, "settled");
  assert.equal(settleCalls, 0);
  assert.deepEqual(steps, ["preparing", "settled"]);
});

test("an issuer-approved response calls settle exactly once", async () => {
  let settleCalls = 0;

  const result = await runClaimFlow({
    signConsent: async () => request("ISSUER_APPROVED"),
    settle: async () => {
      settleCalls += 1;
      return request("SETTLED", { receipt: { txHash: "0xbeef" } });
    },
  });

  assert.equal(settleCalls, 1);
  assert.equal(result.step, "settled");
  assert.equal(result.outcome, "settled");
});

test("a manual consent response waits and does not settle", async () => {
  let settleCalls = 0;

  const result = await runClaimFlow({
    signConsent: async () => request("CONSENTED"),
    settle: async () => {
      settleCalls += 1;
      return null;
    },
  });

  assert.equal(result.step, "waiting");
  assert.equal(result.outcome, "waiting");
  assert.equal(settleCalls, 0);
});

test("a payout that is still in flight reports sending, never settled", async () => {
  const result = await runClaimFlow({
    signConsent: async () => request("ISSUER_APPROVED"),
    settle: async () => request("SUBMITTED"),
  });

  assert.equal(result.step, "sending");
  assert.equal(result.outcome, "sending");
});

test("an auto payout failure surfaces the settleError without auto-retrying", async () => {
  let settleCalls = 0;

  const result = await runClaimFlow({
    signConsent: async () =>
      request("ISSUER_APPROVED", {
        settleError: { code: "PAYOUT_FAILED", message: "The payout did not complete." },
      }),
    settle: async () => {
      settleCalls += 1;
      return null;
    },
  });

  assert.equal(settleCalls, 0);
  assert.equal(result.step, "failed");
  assert.equal(result.error, "The payout did not complete.");
});

test("a signing failure becomes recoverable copy, not a thrown error", async () => {
  const result = await runClaimFlow({
    signConsent: async () => {
      throw new Error("User rejected the signature");
    },
    settle: async () => null,
  });

  assert.equal(result.outcome, "failed");
  assert.equal(result.error, "User rejected the signature");
});

test("a failed settlement is reported honestly", async () => {
  const result = await runClaimFlow({
    signConsent: async () => request("ISSUER_APPROVED"),
    settle: async () => request("FAILED", { failureReason: "Relay exhausted retries" }),
  });

  assert.equal(result.step, "failed");
  assert.equal(result.error, "Relay exhausted retries");
});

test("claimant copy is plain language with no internal jargon", () => {
  const statuses = [
    "CONSENTED",
    "ISSUER_APPROVED",
    "SUBMITTED",
    "SETTLED",
    "FAILED",
    "EXPIRED",
  ] as const;

  for (const status of statuses) {
    const copy = describeClaimStatus(status, "Acme Labs");
    assert.ok(copy.length > 0, `${status} should have copy`);
    assert.doesNotMatch(copy, /Resolver|attestation|digest|D-019/i);
  }

  assert.equal(describeClaimStatus("CONSENTED", "Acme Labs"), "Waiting for Acme Labs to confirm your claim.");
  assert.equal(describeClaimStatus("CONSENTED"), "Waiting for the issuer to confirm your claim.");
  assert.equal(describeClaimStatus("ISSUER_APPROVED"), "Sending your USDC…");
  assert.equal(describeClaimStatus("SETTLED"), "Paid");
});

test("a retry resolves the request the flow created, not only a server-listed one", () => {
  // The Inbox entitlement carries no request after a fresh claim; the flow's own request is the
  // only thing that knows the id. Without this, "Retry payout" is a dead end.
  const flowOnly = resolveRequestId(null, request("SUBMITTED"));
  assert.equal(flowOnly, "req-1");

  // A server-listed request wins when both exist.
  assert.equal(
    resolveRequestId(request("ISSUER_APPROVED"), { ...request("SUBMITTED"), id: "req-2" } as ClaimRequestView),
    "req-1"
  );

  // Nothing to retry at all.
  assert.equal(resolveRequestId(null, null), null);
  assert.equal(resolveRequestId(undefined, undefined), null);
});

test("a poll that moves the claim on outranks the stale local flow result", () => {
  // The wedge this prevents: a manual claim cached CONSENTED, then the issuer approved. Keeping the
  // cached CONSENTED hides the only button that can settle it, for the rest of the session.
  const approved = pickCurrentRequest(
    request("ISSUER_APPROVED", { id: "req-9" }),
    request("CONSENTED")
  );
  assert.equal(approved?.status, "ISSUER_APPROVED");

  // An in-flight local payout must not be clobbered by a still-CONSENTED server view.
  const inFlight = pickCurrentRequest(request("CONSENTED"), request("SUBMITTED"));
  assert.equal(inFlight?.status, "SUBMITTED");

  // A poll-observed terminal state beats a non-terminal local one.
  assert.equal(
    pickCurrentRequest(request("SETTLED", { id: "req-9" }), request("SUBMITTED"))?.status,
    "SETTLED"
  );

  // A tie keeps the local result, which carries the freshest detail (receipt, settleError).
  const withReceipt = request("SETTLED", { receipt: { txHash: "0xfeed" } });
  assert.equal(pickCurrentRequest(request("SETTLED", { id: "req-9" }), withReceipt), withReceipt);

  // Only one side present.
  assert.equal(pickCurrentRequest(null, request("CONSENTED"))?.status, "CONSENTED");
  assert.equal(pickCurrentRequest(request("CONSENTED", { id: "req-9" }), null)?.id, "req-9");
  assert.equal(pickCurrentRequest(null, null), null);
});

test("a completed item always yields a receipt with its explorer hash", () => {
  const entitlement = {
    entitlementId: BASE.entitlementId,
    campaignId: BASE.campaignId,
    amount: BASE.amount,
    status: "COMPLETED",
    settlementTxHash: "0xabc123",
    claimantAddress: BASE.walletAddress,
  } as unknown as NomineEntitlement;

  const receipt = settlementReceiptFor(entitlement);
  assert.equal(receipt?.txHash, "0xabc123");
  assert.equal(receipt?.wallet, BASE.walletAddress);

  // The request's own receipt is authoritative when the inbox carries one.
  const withReceipt = {
    ...entitlement,
    request: request("SETTLED", { receipt: { txHash: "0xdef456" } }),
  } as unknown as NomineEntitlement;
  assert.equal(settlementReceiptFor(withReceipt)?.txHash, "0xdef456");

  // Nothing settled yet: no receipt, so no receipt panel is rendered.
  const unsettled = {
    ...entitlement,
    status: "AVAILABLE",
    settlementTxHash: null,
  } as unknown as NomineEntitlement;
  assert.equal(settlementReceiptFor(unsettled), null);
});
