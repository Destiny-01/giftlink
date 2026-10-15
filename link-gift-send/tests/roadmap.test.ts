/**
 * Roadmap source-of-truth tests.
 *
 * The roadmap is pure data plus two pure helpers, so it runs under the plain `node --test`
 * runner without a DOM. These lock the two invariants the surfaces depend on: every item has a
 * status, and a surface preview contains the next/later items for that surface and never a live
 * one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  roadmap,
  itemsByStatus,
  featuresForSurface,
  type RoadmapStatus,
  type RoadmapSurface,
} from "../src/lib/roadmap.ts";

const STATUSES: RoadmapStatus[] = ["live", "next", "later"];
const SURFACES: RoadmapSurface[] = ["studio", "inbox", "landing"];

test("every roadmap item has a status, an id and copy", () => {
  assert.ok(roadmap.length > 0);
  const ids = new Set<string>();

  for (const item of roadmap) {
    assert.ok(STATUSES.includes(item.status), `${item.id} has an unknown status`);
    assert.ok(item.id.length > 0, "an item has an empty id");
    assert.ok(item.title.trim().length > 0, `${item.id} has an empty title`);
    assert.ok(item.blurb.trim().length > 0, `${item.id} has an empty blurb`);
    assert.ok(!ids.has(item.id), `duplicate roadmap id: ${item.id}`);
    ids.add(item.id);
  }
});

test("the four shipped capabilities are marked live", () => {
  const live = itemsByStatus("live").map((item) => item.id);
  assert.deepEqual(live, [
    "email-addressed-usdc",
    "gasless-claims",
    "automatic-approval",
    "issuer-recovery",
  ]);
});

test("a surface preview never contains a live item", () => {
  for (const surface of SURFACES) {
    const items = featuresForSurface(surface);
    assert.ok(
      items.every((item) => item.status !== "live"),
      `the ${surface} preview included a live item`
    );
  }
});

test("a surface preview filters by surface and keeps product-wide items", () => {
  const studio = featuresForSurface("studio").map((item) => item.id);
  const inbox = featuresForSurface("inbox").map((item) => item.id);

  // Studio-only items.
  assert.ok(studio.includes("csv-import"));
  assert.ok(studio.includes("campaign-analytics"));
  assert.ok(!studio.includes("claim-notifications"));

  // Inbox-only items.
  assert.ok(inbox.includes("claim-notifications"));
  assert.ok(!inbox.includes("csv-import"));
  assert.ok(!inbox.includes("campaign-analytics"));

  // Product-wide items (no surface) appear on both surfaces.
  for (const id of ["more-gates", "multi-chain", "public-issuer-profiles"]) {
    assert.ok(studio.includes(id), `${id} is missing from the studio preview`);
    assert.ok(inbox.includes(id), `${id} is missing from the inbox preview`);
  }
});

test("every next and later item is previewed on at least one surface", () => {
  const previewed = new Set(
    SURFACES.flatMap((surface) =>
      featuresForSurface(surface).map((item) => item.id)
    )
  );

  for (const item of roadmap.filter((entry) => entry.status !== "live")) {
    assert.ok(previewed.has(item.id), `${item.id} is never shown in any preview`);
  }
});
