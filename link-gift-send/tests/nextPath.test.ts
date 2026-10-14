/**
 * Runtime tests for the post-authentication redirect guard.
 *
 * `?next=` arrives through shared links, so only same-origin relative paths may be honoured.
 * Everything else must fall back to the Inbox.
 *
 * Run with: npm test  (node --test, TypeScript stripped natively)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_NEXT_PATH, safeNextPath } from "../src/lib/nextPath.ts";

test("accepts same-origin relative paths", () => {
  assert.equal(safeNextPath("/inbox"), "/inbox");
  assert.equal(safeNextPath("/campaign/abc"), "/campaign/abc");
});

test("rejects absolute, protocol-relative and scheme URLs", () => {
  assert.equal(safeNextPath("https://evil.com"), DEFAULT_NEXT_PATH);
  assert.equal(safeNextPath("//evil.com"), DEFAULT_NEXT_PATH);
  assert.equal(safeNextPath("javascript:alert(1)"), DEFAULT_NEXT_PATH);
});

test("an empty or missing next falls back to the Inbox", () => {
  assert.equal(safeNextPath(""), DEFAULT_NEXT_PATH);
  assert.equal(safeNextPath(null), DEFAULT_NEXT_PATH);
  assert.equal(safeNextPath(undefined), DEFAULT_NEXT_PATH);
});
