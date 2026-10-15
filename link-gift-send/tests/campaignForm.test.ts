/**
 * Runtime tests for the Studio create-form helpers.
 *
 * The payload rule is a contract with the backend, not a UI detail: omitting `issuerApproverAddress`
 * is what selects automatic approval, and sending an empty string would not mean the same thing.
 *
 * Run with: npm test  (node --test, TypeScript stripped natively)
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXPIRY_PRESET,
  buildPreparePayload,
  computeTotalBaseUnits,
  isValidEmail,
  parseRecipientEmails,
  presetExpiry,
} from "../src/lib/campaignForm.ts";

test("parses a pasted list on newlines, commas and semicolons", () => {
  const { emails, invalid, duplicates } = parseRecipientEmails(
    "alice@example.com\nbob@example.com, carol@example.com;dave@example.com"
  );
  assert.deepEqual(emails, [
    "alice@example.com",
    "bob@example.com",
    "carol@example.com",
    "dave@example.com",
  ]);
  assert.deepEqual(invalid, []);
  assert.deepEqual(duplicates, []);
});

test("de-duplicates case-insensitively and keeps the first spelling", () => {
  const { emails, duplicates } = parseRecipientEmails(
    "Alice@Example.com\nalice@example.com\n  alice@EXAMPLE.com  "
  );
  assert.deepEqual(emails, ["Alice@Example.com"]);
  assert.deepEqual(duplicates, ["alice@example.com", "alice@EXAMPLE.com"]);
});

test("flags entries that are not addresses, without dropping the good ones", () => {
  const { emails, invalid } = parseRecipientEmails(
    "alice@example.com\nnot-an-email\nbob@\n@example.com\nalice@example"
  );
  assert.deepEqual(emails, ["alice@example.com"]);
  assert.deepEqual(invalid, ["not-an-email", "bob@", "@example.com", "alice@example"]);
});

test("blank lines and padding never become recipients", () => {
  const { emails, invalid, duplicates } = parseRecipientEmails("\n\n   \n,,\n");
  assert.deepEqual(emails, []);
  assert.deepEqual(invalid, []);
  assert.deepEqual(duplicates, []);
});

test("isValidEmail requires a local part, an @ and a dotted domain", () => {
  assert.equal(isValidEmail("alice@example.com"), true);
  assert.equal(isValidEmail("  alice@example.com  "), true);
  assert.equal(isValidEmail("alice@example"), false);
  assert.equal(isValidEmail("@example.com"), false);
  assert.equal(isValidEmail("alice@"), false);
  assert.equal(isValidEmail("alice example.com"), false);
});

test("the running total is allocation x recipients, in base units", () => {
  // 3 recipients x 1.00 USDC (1e6 base units)
  assert.equal(computeTotalBaseUnits(1_000_000n, 3), 3_000_000n);
  assert.equal(computeTotalBaseUnits(300_000n, 1), 300_000n);
});

test("the running total is null until there is something to fund", () => {
  assert.equal(computeTotalBaseUnits(null, 3), null);
  assert.equal(computeTotalBaseUnits(0n, 3), null);
  assert.equal(computeTotalBaseUnits(1_000_000n, 0), null);
});

test("expiry presets are measured from the opening time", () => {
  const opening = 1_800_000_000;
  assert.equal(presetExpiry("24h", opening), opening + 86_400);
  assert.equal(presetExpiry("7d", opening), opening + 7 * 86_400);
  assert.equal(presetExpiry("30d", opening), opening + 30 * 86_400);
  // "custom" leaves the operator's own value alone.
  assert.equal(presetExpiry("custom", opening), opening);
  assert.equal(DEFAULT_EXPIRY_PRESET, "7d");
});

test("the prepare payload omits issuerApproverAddress when advanced is off", () => {
  const payload = buildPreparePayload({
    allocationBaseUnits: 1_000_000n,
    emails: ["alice@example.com", "bob@example.com"],
    openingTime: 1_800_000_000,
    expiryTime: 1_800_604_800,
    advanced: false,
    issuerApproverAddress: "0x1111111111111111111111111111111111111111",
  });

  assert.equal("issuerApproverAddress" in payload, false);
  assert.deepEqual(payload, {
    allocation: "1000000",
    emails: ["alice@example.com", "bob@example.com"],
    openingTime: 1_800_000_000,
    expiryTime: 1_800_604_800,
  });
});

test("the prepare payload includes the approver only in advanced mode", () => {
  const base = {
    allocationBaseUnits: 1_000_000n,
    emails: ["alice@example.com"],
    openingTime: 1_800_000_000,
    expiryTime: 1_800_604_800,
    issuerApproverAddress: "  0x2222222222222222222222222222222222222222  ",
  };

  const advanced = buildPreparePayload({ ...base, advanced: true });
  assert.equal(
    advanced.issuerApproverAddress,
    "0x2222222222222222222222222222222222222222"
  );

  // Advanced with nothing typed in is still automatic: never send an empty address.
  const blank = buildPreparePayload({ ...base, advanced: true, issuerApproverAddress: "   " });
  assert.equal("issuerApproverAddress" in blank, false);
});
