/**
 * Runtime rendering tests for the Nomine view helpers.
 *
 * These call the real formatter with real opening/expiry values. The previous implementation
 * combined `dateStyle`/`timeStyle` with `timeZoneName`, which Intl rejects with a TypeError, so
 * every timestamp on Studio, the campaign link and the Inbox threw at render time while
 * `tsc`/`vite build` stayed green. Only executing it catches that.
 *
 * Run with: npm test  (node --test, TypeScript stripped natively)
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  formatTimestampWithTimezone,
  formatUsdc,
  formatUsdcDisplay,
  formatUsdcFixed,
} from "../src/lib/format.ts";

/** The real values from the pilot walkthrough. */
const OPENING = 1790436769;
const EXPIRY = 1790436889;

test("renders real opening and expiry timestamps with an explicit timezone", () => {
  for (const ts of [OPENING, EXPIRY]) {
    const rendered = formatTimestampWithTimezone(ts);
    assert.notEqual(rendered, "—");
    // The zone is always stated, both by name and by numeric offset.
    assert.match(rendered, /UTC[+-]\d{2}:\d{2}/);
  }
});

test("a deadline rendered from real unix seconds is a stable, non-empty string", () => {
  const rendered = formatTimestampWithTimezone(EXPIRY);
  assert.equal(typeof rendered, "string");
  assert.ok(rendered.length > 10);
  // Deterministic for the same input, so a re-render cannot flicker.
  assert.equal(rendered, formatTimestampWithTimezone(EXPIRY));
});

test("missing and invalid timestamps render a placeholder instead of throwing", () => {
  assert.equal(formatTimestampWithTimezone(null), "—");
  assert.equal(formatTimestampWithTimezone(undefined), "—");
  assert.equal(formatTimestampWithTimezone(Number.NaN), "—");
});

test("USDC amounts render in base units without throwing", () => {
  assert.equal(formatUsdc("100000"), "0.1");
  assert.equal(formatUsdcDisplay("300000"), "0.3 USDC");
  assert.equal(formatUsdc(null), "0");
});

test("a fixed-decimals amount keeps the campaign progress label readable", () => {
  // The campaign header renders "2.00 / 5.00 USDC paid".
  assert.equal(formatUsdcFixed("2000000"), "2.00");
  assert.equal(formatUsdcFixed("5000000"), "5.00");
  assert.equal(formatUsdcFixed("0"), "0.00");
  assert.equal(formatUsdcFixed(null), "0.00");
  // A part-unit amount must never be rounded away to nothing.
  assert.equal(formatUsdcFixed("1"), "0.000001");
  // ...but an amount that genuinely rounds to a whole number still rounds.
  assert.equal(formatUsdcFixed("999999"), "1.00");
});
