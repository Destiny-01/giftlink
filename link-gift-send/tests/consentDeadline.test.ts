/**
 * Runtime tests for the consent deadline window.
 *
 * WP4 widens the default from one hour to 24 hours because the pilot's issuer approval is a manual
 * step (D-019); a one-hour window could lapse before the issuer confirms a claimant's wallet. The
 * function must still never outlive the campaign expiry and must respect an explicit window.
 *
 * Run with: npm test  (node --test, TypeScript stripped natively)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { defaultConsentDeadline } from "../src/lib/format.ts";

const DAY = 86400;
const HOUR = 3600;
const now = () => Math.floor(Date.now() / 1000);

test("defaults to now + 24 hours", () => {
  const before = now();
  const deadline = defaultConsentDeadline();
  const after = now();
  assert.ok(deadline >= before + DAY, `${deadline} should be at least now + 24h`);
  assert.ok(deadline <= after + DAY, `${deadline} should be at most now + 24h`);
});

test("is capped at the campaign expiry when expiry is sooner", () => {
  const expiry = now() + 60;
  assert.equal(defaultConsentDeadline(expiry), expiry);
});

test("respects an explicit window", () => {
  const before = now();
  const deadline = defaultConsentDeadline(null, HOUR);
  const after = now();
  assert.ok(deadline >= before + HOUR);
  assert.ok(deadline <= after + HOUR);
});

test("an expiry beyond the window does not extend the deadline", () => {
  const expiry = now() + 10 * DAY;
  const before = now();
  const deadline = defaultConsentDeadline(expiry);
  const after = now();
  assert.ok(deadline < expiry);
  assert.ok(deadline >= before + DAY);
  assert.ok(deadline <= after + DAY);
});
