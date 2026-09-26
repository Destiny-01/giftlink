/**
 * Runtime tests for the browser-side records that must survive a failure.
 *
 * These run under Node's own test runner (`npm test`), not a browser harness: they cover the
 * persistence logic itself, which is where the funding-retry and recipient-export bugs lived.
 * Both modules guard every storage access, so missing or throwing storage must degrade rather
 * than crash - which is also asserted here.
 */

import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

// Imported dynamically so the storage stub above is installed before either module runs.
const pending = await import("../src/lib/pendingFunding.ts");
const roster = await import("../src/lib/issuerRoster.ts");

test("a broadcast funding transaction is remembered, per campaign", () => {
  storage.clear();
  assert.equal(pending.readPendingFunding("campaign-a"), null);

  pending.recordPendingFunding({
    campaignId: "campaign-a",
    txHash: "0xabc",
    startedAt: "2026-09-26T00:00:00.000Z",
  });

  assert.equal(pending.readPendingFunding("campaign-a")?.txHash, "0xabc");
  // Scoped per campaign: one draft's transaction must never be replayed for another.
  assert.equal(pending.readPendingFunding("campaign-b"), null);

  pending.clearPendingFunding("campaign-a");
  assert.equal(pending.readPendingFunding("campaign-a"), null);
});

test("a missing or broken storage degrades instead of throwing", () => {
  const original = (globalThis as unknown as { localStorage?: unknown }).localStorage;
  (globalThis as unknown as { localStorage?: unknown }).localStorage = {
    getItem() {
      throw new Error("storage disabled");
    },
    setItem() {
      throw new Error("storage disabled");
    },
  };

  try {
    assert.equal(pending.readPendingFunding("campaign-a"), null);
    pending.recordPendingFunding({ campaignId: "c", txHash: "0x1", startedAt: "now" });
    assert.deepEqual(roster.loadRoster("campaign-a"), []);
  } finally {
    (globalThis as unknown as { localStorage?: unknown }).localStorage = original;
  }
});

test("the issuer retains the mapping it will approve against", () => {
  storage.clear();
  roster.saveRoster("campaign-a", [
    { entitlementId: "0xAA", email: "alice@example.test" },
    { entitlementId: "0xBB", email: "bob@example.test" },
  ]);

  // Identifier comparison is case-insensitive, so a checksummed id still resolves.
  assert.equal(roster.rosterEmailFor("campaign-a", "0xaa"), "alice@example.test");
  assert.equal(roster.rosterEmailFor("campaign-a", "0xcc"), null);
  assert.deepEqual(roster.loadRoster("campaign-a").length, 2);

  const csv = roster.rosterCsv([{ entitlementId: "0xAA", email: 'weird,"quote"' }]);
  assert.equal(csv.split("\n")[0], "entitlement_id,email");
  assert.match(csv, /"weird,""quote"""/);
});
