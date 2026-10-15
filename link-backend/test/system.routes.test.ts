import "./setup";
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import {
  TEST_CHAIN_ID,
  TEST_CLAIM_CORE_ADDRESS,
  TEST_USDC_ADDRESS,
} from "./setup";
import { env } from "../src/config/env";

/**
 * System surface (config/health/studio access) and the Studio guardrails, driven through the
 * real app so the middleware, controllers and service policy are all exercised. The identity
 * provider and the database are stubbed at their own boundaries, so the real auth middleware,
 * validation and `prepareCampaign` code run.
 */
const ISSUER_WALLET = "0x" + "66".repeat(20);
const ISSUER_APPROVER = "0x" + "77".repeat(20);
const ALLOWED_PRIVY_ID = "did:privy:allowed";
const OTHER_PRIVY_ID = "did:privy:other";
const ALLOWED_TOKEN = "token-allowed";
const OTHER_TOKEN = "token-other";

const accounts: Record<string, { id: string; wallets: string[] }> = {
  [ALLOWED_TOKEN]: { id: ALLOWED_PRIVY_ID, wallets: [ISSUER_WALLET] },
  [OTHER_TOKEN]: { id: OTHER_PRIVY_ID, wallets: [ISSUER_WALLET] },
};

const privyModule = require("../src/config/privy") as typeof import("../src/config/privy");
(privyModule.privyClient as unknown as Record<string, unknown>).getUser = async ({
  idToken,
}: {
  idToken: string;
}) => {
  const account = accounts[idToken];
  if (!account) {
    throw new Error("unknown synthetic identity token");
  }
  return {
    id: account.id,
    linkedAccounts: account.wallets.map((address) => ({
      type: "wallet",
      address,
      walletClientType: "privy",
    })),
  };
};

let createdCampaigns = 0;
let checkpointRow: { lastScannedBlock: bigint } | null = null;

const prismaModule = require("../src/config/prisma") as typeof import("../src/config/prisma");
const prisma = prismaModule.prisma as unknown as Record<string, any>;

prisma.user.upsert = async ({ where }: { where: { privyId: string } }) => ({
  id: `row_${where.privyId}`,
  privyId: where.privyId,
  walletAddress: ISSUER_WALLET.toLowerCase(),
  email: null,
  discordId: null,
  twitterId: null,
  telegramId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

prisma.campaign.create = async () => {
  createdCampaigns += 1;
  return { id: "campaign-1" };
};

prisma.chainCheckpoint.findUnique = async () => checkpointRow;

const { createApp } = require("../src/app") as typeof import("../src/app");

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
});

function get(path: string, token?: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function post(path: string, token: string | undefined, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function prepareBody(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    allocation: "500000",
    emails: ["a@example.test", "b@example.test"],
    openingTime: now,
    expiryTime: now + 3600,
    issuerApproverAddress: ISSUER_APPROVER,
    ...overrides,
  };
}

beforeEach(() => {
  createdCampaigns = 0;
  checkpointRow = null;
  env.ISSUER_ALLOWLIST = [];
  env.MAX_CAMPAIGN_BUDGET_USDC = undefined;
  env.MAX_CAMPAIGN_RECIPIENTS = undefined;
});

describe("GET /api/config", () => {
  test("returns the public network identity and null limits when unlimited", async () => {
    const response = await get("/api/config");
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      network: "testnet",
      chainId: TEST_CHAIN_ID,
      claimCoreAddress: TEST_CLAIM_CORE_ADDRESS.toLowerCase(),
      usdcAddress: TEST_USDC_ADDRESS.toLowerCase(),
      autoApproverAddress: null,
      studioInviteOnly: false,
      limits: null,
    });
  });

  test("reports invite-only and the caps once they are configured", async () => {
    env.ISSUER_ALLOWLIST = [ALLOWED_PRIVY_ID];
    env.MAX_CAMPAIGN_BUDGET_USDC = "100";
    env.MAX_CAMPAIGN_RECIPIENTS = 50;

    const response = await get("/api/config");
    const body = (await response.json()) as {
      studioInviteOnly: boolean;
      limits: { maxBudgetUsdc: string; maxRecipients: number };
    };

    assert.equal(body.studioInviteOnly, true);
    assert.deepEqual(body.limits, { maxBudgetUsdc: "100", maxRecipients: 50 });
  });
});

describe("GET /api/health", () => {
  test("reports ok with a null checkpoint when none exists", async () => {
    const response = await get("/api/health");
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      ok: true,
      network: "testnet",
      chainId: TEST_CHAIN_ID,
      claimCore: TEST_CLAIM_CORE_ADDRESS.toLowerCase(),
      indexer: { lastScannedBlock: null },
    });
  });

  test("reports the indexed checkpoint when it exists", async () => {
    checkpointRow = { lastScannedBlock: 67_150_000n };

    const response = await get("/api/health");
    const body = (await response.json()) as {
      indexer: { lastScannedBlock: string | null };
    };

    assert.equal(body.indexer.lastScannedBlock, "67150000");
  });
});

describe("GET /api/studio/access", () => {
  test("requires authentication", async () => {
    const response = await get("/api/studio/access");
    assert.equal(response.status, 401);
  });

  test("an open allowlist admits everyone", async () => {
    const response = await get("/api/studio/access", OTHER_TOKEN);
    const body = (await response.json()) as { allowed: boolean };

    assert.equal(response.status, 200);
    assert.equal(body.allowed, true);
  });

  test("a non-empty allowlist admits only listed issuers", async () => {
    env.ISSUER_ALLOWLIST = [ALLOWED_PRIVY_ID];

    const allowed = await get("/api/studio/access", ALLOWED_TOKEN);
    assert.deepEqual(await allowed.json(), { allowed: true });

    const refused = await get("/api/studio/access", OTHER_TOKEN);
    assert.deepEqual(await refused.json(), { allowed: false });
  });
});

describe("prepare campaign guardrails", () => {
  test("a non-allowlisted issuer is refused with a code", async () => {
    env.ISSUER_ALLOWLIST = [OTHER_PRIVY_ID];

    const response = await post("/api/campaigns/prepare", ALLOWED_TOKEN, prepareBody());
    const body = (await response.json()) as { error: { code?: string } };

    assert.equal(response.status, 403);
    assert.equal(body.error.code, "issuer_not_allowlisted");
    assert.equal(createdCampaigns, 0, "a refused prepare still created a campaign");
  });

  test("an allowlisted issuer passes", async () => {
    env.ISSUER_ALLOWLIST = [ALLOWED_PRIVY_ID];

    const response = await post("/api/campaigns/prepare", ALLOWED_TOKEN, prepareBody());

    assert.equal(response.status, 201);
    assert.equal(createdCampaigns, 1);
  });

  test("an empty allowlist passes", async () => {
    const response = await post("/api/campaigns/prepare", OTHER_TOKEN, prepareBody());

    assert.equal(response.status, 201);
    assert.equal(createdCampaigns, 1);
  });

  test("exceeding the recipient cap is refused with a code, exactly at it passes", async () => {
    env.MAX_CAMPAIGN_RECIPIENTS = 1;

    const over = await post(
      "/api/campaigns/prepare",
      ALLOWED_TOKEN,
      prepareBody({ emails: ["a@example.test", "b@example.test"] })
    );
    const overBody = (await over.json()) as { error: { code?: string; message: string } };

    assert.equal(over.status, 400);
    assert.equal(overBody.error.code, "campaign_cap_exceeded");
    assert.match(overBody.error.message, /limit/);
    assert.equal(createdCampaigns, 0);

    env.MAX_CAMPAIGN_RECIPIENTS = 2;
    const atLimit = await post(
      "/api/campaigns/prepare",
      ALLOWED_TOKEN,
      prepareBody({ emails: ["a@example.test", "b@example.test"] })
    );
    assert.equal(atLimit.status, 201);
  });

  test("exceeding the budget cap is refused with a code, exactly at it passes", async () => {
    // 1 USDC = 1_000_000 base units.
    env.MAX_CAMPAIGN_BUDGET_USDC = "1";

    const over = await post(
      "/api/campaigns/prepare",
      ALLOWED_TOKEN,
      prepareBody({ allocation: "600000", emails: ["a@example.test", "b@example.test"] })
    );
    const overBody = (await over.json()) as { error: { code?: string; message: string } };

    assert.equal(over.status, 400);
    assert.equal(overBody.error.code, "campaign_cap_exceeded");
    assert.match(overBody.error.message, /limit/);
    assert.equal(createdCampaigns, 0);

    // 500000 × 2 = 1_000_000, exactly the cap.
    const atLimit = await post(
      "/api/campaigns/prepare",
      ALLOWED_TOKEN,
      prepareBody({ allocation: "500000", emails: ["a@example.test", "b@example.test"] })
    );
    assert.equal(atLimit.status, 201);
  });

  test("duplicate emails are deduplicated before the cap is applied", async () => {
    env.MAX_CAMPAIGN_RECIPIENTS = 1;

    const response = await post(
      "/api/campaigns/prepare",
      ALLOWED_TOKEN,
      prepareBody({ emails: ["same@example.test", "same@example.test"] })
    );

    assert.equal(response.status, 201);
    assert.equal(createdCampaigns, 1);
  });
});
