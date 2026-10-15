/**
 * Runtime tests for the issuer's recipient view.
 *
 * The join is the risky part: the server knows identifiers and statuses but never emails, and the
 * issuer's local record knows emails but not statuses. A row that silently disappears, or an
 * unresolved row that is hidden, is how a wrong wallet gets approved.
 *
 * Run with: node --test (npm test)
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRecipientRows,
  claimedCount,
  recipientStatusFor,
} from "../src/lib/campaignRecipients.ts";
import type { IssuerApprovalRequest } from "../src/types/nomine.ts";

const REQUEST = {
  id: "req-1",
  campaignId: "campaign-1",
  entitlementId: "0xAA",
  walletAddress: "0x1111111111111111111111111111111111111111",
  amount: "1000000",
  deadline: 1_800_000_000,
} as const;

function request(overrides: Record<string, unknown> = {}): IssuerApprovalRequest {
  return { ...REQUEST, ...overrides } as unknown as IssuerApprovalRequest;
}

test("maps a request status to one of the four issuer-facing states", () => {
  assert.equal(recipientStatusFor(undefined, false), "NOT_CLAIMED");
  assert.equal(recipientStatusFor(undefined, true), "EXPIRED");
  assert.equal(recipientStatusFor(request({ status: "CONSENTED" }), false), "CLAIMING");
  assert.equal(recipientStatusFor(request({ status: "ISSUER_APPROVED" }), false), "CLAIMING");
  assert.equal(recipientStatusFor(request({ status: "SUBMITTED" }), false), "CLAIMING");
  // A failed attempt consumed nothing, so the payout can still be retried.
  assert.equal(recipientStatusFor(request({ status: "FAILED" }), false), "CLAIMING");
  assert.equal(recipientStatusFor(request({ status: "SETTLED" }), false), "PAID");
  assert.equal(recipientStatusFor(request({ status: "EXPIRED" }), true), "EXPIRED");
});

test("joins the local record with the live requests, one row per recipient", () => {
  const rows = buildRecipientRows(
    [
      { entitlementId: "0xAA", email: "alice@example.com" },
      { entitlementId: "0xBB", email: "bob@example.com" },
      { entitlementId: "0xCC", email: "carol@example.com" },
    ],
    [
      request({ entitlementId: "0xAA", status: "SETTLED", settlementTxHash: "0xpaid" }),
      request({ entitlementId: "0xBB", status: "CONSENTED" }),
    ],
    { campaignExpired: false }
  );

  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => [row.email, row.status]),
    [
      ["alice@example.com", "PAID"],
      ["bob@example.com", "CLAIMING"],
      ["carol@example.com", "NOT_CLAIMED"],
    ]
  );
  assert.equal(rows[0].settlementTxHash, "0xpaid");
  assert.equal(rows[1].walletAddress, REQUEST.walletAddress);
  // Nobody has consented for carol yet, so there is no wallet to show.
  assert.equal(rows[2].walletAddress, null);
  // The live request rides along with the row: the approve action needs its identifier.
  assert.equal(rows[1].request?.id, "req-1");
  assert.equal(rows[0].request?.status, "SETTLED");
  assert.equal(rows[2].request, null);
});

test("an identifier with no local record is shown, not hidden", () => {
  const rows = buildRecipientRows([], [request({ entitlementId: "0xDD", status: "CONSENTED" })], {
    campaignExpired: false,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, null);
  assert.equal(rows[0].entitlementId, "0xDD");
  assert.equal(rows[0].status, "CLAIMING");
});

test("comparison is case-insensitive and duplicate identifiers collapse to one row", () => {
  const rows = buildRecipientRows(
    [
      { entitlementId: "0xAA", email: "alice@example.com" },
      { entitlementId: "0xaa", email: "alice@example.com" },
    ],
    [request({ entitlementId: "0xAa", status: "SETTLED" })],
    { campaignExpired: false }
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "PAID");
  assert.equal(rows[0].email, "alice@example.com");
});

test("an expired campaign marks unclaimed recipients expired", () => {
  const rows = buildRecipientRows(
    [{ entitlementId: "0xAA", email: "alice@example.com" }],
    [],
    { campaignExpired: true }
  );
  assert.equal(rows[0].status, "EXPIRED");
});

test("the claimed count prefers the server's number and falls back to settled requests", () => {
  const requests = [
    request({ status: "SETTLED" }),
    request({ status: "SETTLED" }),
    request({ status: "CONSENTED" }),
  ];

  assert.equal(claimedCount({ consumedCount: 1, entitlementCount: 5 }, requests), 1);
  // An absent count is derived from what is on hand.
  assert.equal(claimedCount({ consumedCount: null, entitlementCount: 5 }, requests), 2);
  assert.equal(claimedCount({ entitlementCount: 5 }, requests), 2);
  // Never reports more claimed than the campaign holds.
  assert.equal(claimedCount({ consumedCount: 9, entitlementCount: 5 }, []), 5);
});
