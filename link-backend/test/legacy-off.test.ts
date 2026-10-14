import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import { TEST_DROP_ID } from "./setup";

/**
 * Legacy support is switched off *before* any application module is loaded, so the env parse
 * and the route table are built with it disabled. `test/setup.ts` turns legacy on for the
 * rest of the suite, so this override has to happen first - hence the `require` below rather
 * than a hoisted import.
 */
process.env.ENABLE_LEGACY_GIFTLINK = "false";

// The health probe reads the checkpoint; stub the DB so this file needs no database.
const prismaModule = require("../src/config/prisma") as typeof import("../src/config/prisma");
(prismaModule.prisma as unknown as Record<string, any>).chainCheckpoint.findUnique =
  async () => null;

const { createApp } = require("../src/app") as typeof import("../src/app");

test("legacy routes are not mounted when legacy support is off", async () => {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    const drop = await fetch(`${base}/api/drops/${TEST_DROP_ID}`);
    assert.equal(drop.status, 404, "the legacy /drops surface should not be mounted");

    const stats = await fetch(`${base}/api/stats/overview`);
    assert.equal(stats.status, 404, "the legacy /stats surface should not be mounted");

    // The shared and Nomine surfaces remain mounted.
    const config = await fetch(`${base}/api/config`);
    assert.equal(config.status, 200);
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
  } finally {
    server.close();
  }
});
