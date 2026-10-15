/**
 * Runtime tests for the MonoValue truncation rule and the signed-out email hint.
 *
 * MonoValue can never overflow its container only if the truncation itself is bounded, and the hint
 * must never reveal a full address before authentication. Both are pure, so they execute here.
 *
 * Run with: npm test  (node --test, TypeScript stripped natively)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { MONO_HEAD, MONO_TAIL, maskEmail, truncateMono } from "../src/lib/mono.ts";

test("shows the first 6 and last 4 characters of an address", () => {
  const address = "0x1234567890abcdef1234567890abcdef12345678";
  const rendered = truncateMono(address);
  assert.equal(rendered, `${address.slice(0, MONO_HEAD)}…${address.slice(-MONO_TAIL)}`);
  assert.equal(rendered, "0x1234…5678");
  // The rendered form is far shorter than the value, which is what stops the overflow.
  assert.ok(rendered.length < address.length);
});

test("never adds an ellipsis to a value that already fits", () => {
  assert.equal(truncateMono("0xabcd"), "0xabcd");
  assert.equal(truncateMono("1234567890"), "1234567890");
  assert.ok(!truncateMono("1234567890").includes("…"));
});

test("renders a placeholder for missing values instead of throwing", () => {
  assert.equal(truncateMono(null), "");
  assert.equal(truncateMono(undefined), "");
  assert.equal(truncateMono(""), "");
});

test("masks an email so the signed-out hint never reveals it", () => {
  const masked = maskEmail("alice@example.com");
  assert.equal(masked, "a***@e***.com");
  assert.ok(!masked?.includes("alice"));
  assert.ok(!masked?.includes("example"));
});

test("returns no hint for input that is not an email", () => {
  assert.equal(maskEmail(null), null);
  assert.equal(maskEmail(undefined), null);
  assert.equal(maskEmail("not-an-email"), null);
  assert.equal(maskEmail("trailing@"), null);
});
