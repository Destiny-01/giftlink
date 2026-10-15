import "./setup";
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Wallet } from "ethers";

import {
  RECIPIENT_EMAIL,
  RECIPIENT_WALLET,
  RECIPIENT_WALLET_KEY,
  TEST_CHAIN_ID,
  TEST_CLAIM_CORE_ADDRESS,
  TEST_USDC_ADDRESS,
  makeAuthUser,
} from "./setup";

/**
 * Automatic approval and instant payout (issue #25).
 *
 * The environment is configured with an auto-approver *before* any application module is
 * imported, because `config/env.ts` parses once at import and `config/wallets.ts` derives the
 * auto-approver signer from it. Everything downstream - `prepareCampaign`'s default approver,
 * the `auto`/`manual` derivation, and the consent-time attestation - is then the real code,
 * with only the identity provider and the database stubbed at their boundaries.
 */
const AUTO_APPROVER_KEY = "0x" + "44".repeat(32);
const AUTO_APPROVER_ADDRESS = new Wallet(AUTO_APPROVER_KEY).address;
process.env.AUTO_APPROVER_PRIVATE_KEY = AUTO_APPROVER_KEY;
process.env.AUTO_APPROVER_ADDRESS = AUTO_APPROVER_ADDRESS;

const MANUAL_APPROVER = "0x" + "55".repeat(20);
const ISSUER_WALLET = "0x" + "66".repeat(20);
const ISSUER_PRIVY_ID = "did:privy:auto-issuer";
const RECIPIENT_PRIVY_ID = "did:privy:auto-recipient";
const ISSUER_TOKEN = "token-auto-issuer";
const RECIPIENT_TOKEN = "token-auto-recipient";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const ENTITLEMENT_ID = "0x" + "ab".repeat(32);

// ---- Identity provider stub (the one seam the real code cannot avoid) ----
const accounts: Record<
  string,
  { id: string; email: string | null; wallets: string[] }
> = {
  [ISSUER_TOKEN]: { id: ISSUER_PRIVY_ID, email: "issuer-auto@example.test", wallets: [ISSUER_WALLET] },
  [RECIPIENT_TOKEN]: { id: RECIPIENT_PRIVY_ID, email: RECIPIENT_EMAIL, wallets: [RECIPIENT_WALLET] },
};

function providerUserFor(account: { id: string; email: string | null; wallets: string[] }) {
  return {
    id: account.id,
    linkedAccounts: [
      ...account.wallets.map((address) => ({
        type: "wallet" as const,
        address,
        walletClientType: "privy",
      })),
      ...(account.email ? [{ type: "email" as const, address: account.email }] : []),
    ],
  };
}

const privyModule = require("../src/config/privy") as typeof import("../src/config/privy");
const privyClient = privyModule.privyClient as unknown as Record<string, unknown>;
privyClient.getUser = async ({ idToken }: { idToken: string }) => {
  const account = accounts[idToken];
  if (!account) {
    throw new Error("unknown synthetic identity token");
  }
  return providerUserFor(account);
};
privyClient.verifyAuthToken = async (authToken: string) => {
  const account = accounts[authToken];
  if (!account) {
    throw new Error("unknown synthetic identity token");
  }
  return { userId: account.id };
};
privyClient.getUserById = async (userId: string) => {
  const account = Object.values(accounts).find((entry) => entry.id === userId);
  if (!account) {
    throw new Error("unknown synthetic user id");
  }
  return providerUserFor(account);
};

// ---- Database stub: a tiny in-memory store the service writes through ----
interface Store {
  campaign: Record<string, any> | null;
  entitlement: Record<string, any> | null;
  request: Record<string, any> | null;
  createdCampaignData: Record<string, any> | null;
  createdCount: number;
  approvalWrites: number;
}

const store: Store = {
  campaign: null,
  entitlement: null,
  request: null,
  createdCampaignData: null,
  createdCount: 0,
  approvalWrites: 0,
};

const prismaModule = require("../src/config/prisma") as typeof import("../src/config/prisma");
const prisma = prismaModule.prisma as unknown as Record<string, any>;

prisma.user.upsert = async ({ where }: { where: { privyId: string } }) => ({
  id: `row_${where.privyId}`,
  privyId: where.privyId,
  walletAddress: null,
  email: null,
  discordId: null,
  twitterId: null,
  telegramId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});
prisma.chainCheckpoint.findUnique = async () => null;
prisma.campaign.findMany = async () => [];
prisma.campaign.findUnique = async ({ where }: { where: { id: string } }) =>
  store.campaign && store.campaign.id === where.id ? store.campaign : null;
prisma.campaign.create = async ({ data }: { data: Record<string, any> }) => {
  store.createdCampaignData = data;
  return { id: CAMPAIGN_ID, ...data };
};
prisma.entitlement.findUnique = async ({
  where,
}: {
  where: { campaignId_entitlementId: { campaignId: string; entitlementId: string } };
}) => {
  const key = where.campaignId_entitlementId;
  if (
    store.entitlement &&
    store.entitlement.campaignId === key.campaignId &&
    store.entitlement.entitlementId === key.entitlementId
  ) {
    return store.entitlement;
  }
  return null;
};
prisma.claimRequest.findUnique = async ({
  where,
}: {
  where:
    | { id: string }
    | { campaignId_entitlementId: { campaignId: string; entitlementId: string } };
}) => {
  if (!store.request) return null;
  if ("id" in where) {
    return store.request.id === where.id ? store.request : null;
  }
  const key = where.campaignId_entitlementId;
  return store.request.campaignId === key.campaignId &&
    store.request.entitlementId === key.entitlementId
    ? store.request
    : null;
};
prisma.claimRequest.create = async ({ data }: { data: Record<string, any> }) => {
  store.createdCount += 1;
  store.request = {
    id: REQUEST_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    issuerApprovalSignature: null,
    resolverSignature: null,
    submitTxHash: null,
    submitAttemptId: null,
    settlementTxHash: null,
    failureReason: null,
    ...data,
  };
  return store.request;
};
prisma.claimRequest.updateMany = async ({
  where,
  data,
}: {
  where: { id?: string; status?: { in: string[] } };
  data: Record<string, any>;
}) => {
  store.approvalWrites += 1;
  if (!store.request) return { count: 0 };
  // Honor the status/id predicate the service relies on, so the guard inside
  // `storeVerifiedApproval` is genuinely exercised rather than stubbed away.
  if (where.id !== undefined && store.request.id !== where.id) return { count: 0 };
  if (where.status?.in && !where.status.in.includes(store.request.status)) {
    return { count: 0 };
  }
  Object.assign(store.request, data);
  return { count: 1 };
};

// ---- RPC stub: the deployment answers, the relayer has no gas ----
const claimCoreAbiModule = require("../src/config/claimCoreAbi") as typeof import("../src/config/claimCoreAbi");
const arcModule = require("../src/config/arcClient") as typeof import("../src/config/arcClient");
const provider = arcModule.getRpcProvider() as unknown as Record<string, any>;
provider.getNetwork = async () => ({ chainId: BigInt(TEST_CHAIN_ID), name: "test" });
provider.getBalance = async () => 0n;
provider.call = async (tx: { data?: string }) => {
  const selector = String(tx.data ?? "").slice(0, 10);
  if (selector === claimCoreAbiModule.nomineClaimCoreInterface.getFunction("USDC")!.selector) {
    return claimCoreAbiModule.nomineClaimCoreInterface.encodeFunctionResult("USDC", [
      TEST_USDC_ADDRESS,
    ]);
  }
  throw new Error(`unexpected contract call in test: ${selector}`);
};

const claimCoreEvidence = require("../src/services/claimCoreEvidence") as typeof import("../src/services/claimCoreEvidence");

const {
  createConsent,
  submitIssuerApproval,
  approvalModeOf,
  buildApprovalPayload,
} = require("../src/services/claimRequestService") as typeof import("../src/services/claimRequestService");
const { prepareCampaign } = require("../src/services/campaignService") as typeof import("../src/services/campaignService");
const claimCore = require("../src/utils/claimCore") as typeof import("../src/utils/claimCore");
const { ValidationError, ForbiddenError } = require("../src/utils/errors") as typeof import("../src/utils/errors");
const wallets = require("../src/config/wallets") as typeof import("../src/config/wallets");

const { createApp } = require("../src/app") as typeof import("../src/app");
const { env } = require("../src/config/env") as typeof import("../src/config/env");

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

function get(path: string) {
  return fetch(`${baseUrl}${path}`);
}

function makeCampaign(approver: string) {
  return {
    id: CAMPAIGN_ID,
    chainId: TEST_CHAIN_ID,
    contractAddress: TEST_CLAIM_CORE_ADDRESS.toLowerCase(),
    onchainId: 100n,
    issuerPrivyId: ISSUER_PRIVY_ID,
    issuerAddress: ISSUER_WALLET.toLowerCase(),
    issuerApproverAddress: approver.toLowerCase(),
    resolverAddress: wallets.backendSigner.address.toLowerCase(),
    allocation: "500000",
    entitlementCount: 1,
    fundingTxHash: "0x" + "cc".repeat(32),
    paramsHash: "0x" + "ab".repeat(32),
    openingTime: new Date(Date.now() - 3_600_000),
    expiryTime: new Date(Date.now() + 3_600_000),
    status: "FUNDED",
    reclaimedTxHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeEntitlement() {
  return {
    id: "ent-1",
    campaignId: CAMPAIGN_ID,
    entitlementId: ENTITLEMENT_ID,
    emailHash: claimCore.emailHashFor(RECIPIENT_EMAIL),
    consumedAt: null,
    settlementTxHash: null,
    claimantAddress: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const recipientUser = () =>
  makeAuthUser({
    privyUserId: RECIPIENT_PRIVY_ID,
    email: RECIPIENT_EMAIL,
    walletAddresses: [RECIPIENT_WALLET],
  });

const issuerUser = () =>
  makeAuthUser({
    privyUserId: ISSUER_PRIVY_ID,
    email: "issuer-auto@example.test",
    walletAddresses: [ISSUER_WALLET],
  });

/** A real consent signature over the exact request the service will verify. */
async function signedConsent() {
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const payload = {
    campaignId: 100n,
    entitlementId: ENTITLEMENT_ID,
    wallet: RECIPIENT_WALLET.toLowerCase(),
    amount: BigInt("500000"),
    deadline,
  };
  const signature = await new Wallet(RECIPIENT_WALLET_KEY).signTypedData(
    claimCore.claimCoreDomain(),
    claimCore.CLAIM_REQUEST_TYPES,
    payload
  );
  return {
    entitlementId: ENTITLEMENT_ID,
    walletAddress: RECIPIENT_WALLET,
    amount: "500000",
    deadline,
    signature,
  };
}

beforeEach(() => {
  store.campaign = null;
  store.entitlement = null;
  store.request = null;
  store.createdCampaignData = null;
  store.createdCount = 0;
  store.approvalWrites = 0;
  claimCoreEvidence.resetClaimCoreViewCache();
});

describe("prepareCampaign and the auto-approver default", () => {
  const prepareInput = () => {
    const now = Math.floor(Date.now() / 1000);
    return {
      allocation: "500000",
      emails: ["a@example.test"],
      openingTime: now,
      expiryTime: now + 3600,
    };
  };

  test("an omitted approver uses the configured auto-approver", async () => {
    const result = await prepareCampaign(prepareInput(), issuerUser());

    assert.equal(
      store.createdCampaignData?.issuerApproverAddress,
      AUTO_APPROVER_ADDRESS.toLowerCase()
    );
    assert.equal(result.config.issuerApprover, AUTO_APPROVER_ADDRESS.toLowerCase());
  });

  test("an omitted approver with no auto-approver configured errors", async () => {
    const saved = env.AUTO_APPROVER_ADDRESS;
    env.AUTO_APPROVER_ADDRESS = undefined;
    try {
      await assert.rejects(
        () => prepareCampaign(prepareInput(), issuerUser()),
        (error: unknown) =>
          error instanceof ValidationError &&
          /Provide an issuer approver address/.test(error.message)
      );
      assert.equal(store.createdCampaignData, null, "a campaign was created anyway");
    } finally {
      env.AUTO_APPROVER_ADDRESS = saved;
    }
  });

  test("an explicit approver is kept", async () => {
    const explicit = "0x" + "99".repeat(20);
    const result = await prepareCampaign(
      { ...prepareInput(), issuerApproverAddress: explicit },
      issuerUser()
    );

    assert.equal(store.createdCampaignData?.issuerApproverAddress, explicit);
    assert.equal(result.config.issuerApprover, explicit);
  });
});

describe("createConsent on an auto campaign", () => {
  test("stores an auto-approver attestation and reports ISSUER_APPROVED", async () => {
    store.campaign = makeCampaign(AUTO_APPROVER_ADDRESS);
    store.entitlement = makeEntitlement();

    const receipt = await createConsent(CAMPAIGN_ID, await signedConsent(), recipientUser());

    assert.equal(receipt.status, "ISSUER_APPROVED");
    assert.equal(receipt.hasIssuerApproval, true);
    assert.equal(receipt.approvalMode, "auto");
    assert.equal(store.createdCount, 1);
    assert.equal(store.approvalWrites, 1);

    const approval = buildApprovalPayload(store.campaign as any, store.request as any);
    assert.equal(
      claimCore.recoverApprovalSigner(approval, store.request!.issuerApprovalSignature),
      AUTO_APPROVER_ADDRESS.toLowerCase()
    );
  });

  test("a second consent on the approved request is idempotent", async () => {
    store.campaign = makeCampaign(AUTO_APPROVER_ADDRESS);
    store.entitlement = makeEntitlement();
    const body = await signedConsent();

    const first = await createConsent(CAMPAIGN_ID, body, recipientUser());
    const second = await createConsent(CAMPAIGN_ID, body, recipientUser());

    assert.equal(first.status, "ISSUER_APPROVED");
    assert.equal(second.status, "ISSUER_APPROVED");
    assert.equal(second.approvalMode, "auto");
    // No second request and no second approval write: the re-consent converged.
    assert.equal(store.createdCount, 1);
    assert.equal(store.approvalWrites, 1);
  });

  test("a manual campaign stays CONSENTED and is not auto-approved", async () => {
    store.campaign = makeCampaign(MANUAL_APPROVER);
    store.entitlement = makeEntitlement();

    const receipt = await createConsent(CAMPAIGN_ID, await signedConsent(), recipientUser());

    assert.equal(receipt.status, "CONSENTED");
    assert.equal(receipt.hasIssuerApproval, false);
    assert.equal(receipt.approvalMode, "manual");
    assert.equal(store.approvalWrites, 0);
  });

  test("submitIssuerApproval is refused on an auto campaign", async () => {
    store.campaign = makeCampaign(AUTO_APPROVER_ADDRESS);

    try {
      await submitIssuerApproval(CAMPAIGN_ID, REQUEST_ID, "0xdead", issuerUser());
      assert.fail("expected the manual approval to be refused");
    } catch (error) {
      assert.ok(error instanceof ValidationError);
      assert.match((error as Error).message, /approves automatically/);
      assert.equal((error as { code?: string }).code, "campaign_auto_approval");
    }
  });

  test("a non-issuer is still refused before the auto check", async () => {
    store.campaign = makeCampaign(AUTO_APPROVER_ADDRESS);

    await assert.rejects(
      () => submitIssuerApproval(CAMPAIGN_ID, REQUEST_ID, "0xdead", recipientUser()),
      (error: unknown) => error instanceof ForbiddenError
    );
  });
});

describe("approval mode derivation", () => {
  test("matches the configured approver case-insensitively and defaults to manual", () => {
    assert.equal(
      approvalModeOf({ issuerApproverAddress: AUTO_APPROVER_ADDRESS }),
      "auto"
    );
    assert.equal(
      approvalModeOf({ issuerApproverAddress: AUTO_APPROVER_ADDRESS.toUpperCase() }),
      "auto"
    );
    assert.equal(approvalModeOf({ issuerApproverAddress: MANUAL_APPROVER }), "manual");
  });
});

describe("POST /api/users/authenticate", () => {
  test("a valid token resolves the user by id and returns 200", async () => {
    const response = await post("/api/users/authenticate", undefined, {
      authToken: RECIPIENT_TOKEN,
    });
    const body = (await response.json()) as { privyUserId: string; user: { privyId: string } };

    assert.equal(response.status, 200);
    assert.equal(body.privyUserId, RECIPIENT_PRIVY_ID);
    assert.equal(body.user.privyId, RECIPIENT_PRIVY_ID);
  });

  test("an unknown token is rejected without a 500", async () => {
    const response = await post("/api/users/authenticate", undefined, {
      authToken: "token-not-real",
    });

    assert.equal(response.status, 401);
  });
});

describe("GET /api/config", () => {
  test("reports the configured auto-approver address", async () => {
    const response = await get("/api/config");
    const body = (await response.json()) as { autoApproverAddress: string | null };

    assert.equal(response.status, 200);
    assert.equal(body.autoApproverAddress, AUTO_APPROVER_ADDRESS.toLowerCase());
  });
});

describe("consent auto-settles for an auto campaign", () => {
  test("a settlement failure still returns the ISSUER_APPROVED receipt with settleError", async () => {
    store.campaign = makeCampaign(AUTO_APPROVER_ADDRESS);
    store.entitlement = makeEntitlement();
    // The relayer has no gas, so settlement throws after the consent is approved.
    provider.getBalance = async () => 0n;

    const response = await post(
      `/api/campaigns/${CAMPAIGN_ID}/consent`,
      RECIPIENT_TOKEN,
      await signedConsent()
    );
    const body = (await response.json()) as {
      status: string;
      settlementTxHash: string | null;
      approvalMode: string;
      settleError?: { code: string; message: string };
    };

    assert.equal(response.status, 200);
    assert.equal(body.status, "ISSUER_APPROVED");
    assert.equal(body.approvalMode, "auto");
    assert.equal(body.settlementTxHash, null);
    assert.ok(body.settleError, "expected a settleError so the UI can offer a retry");
    assert.equal(body.settleError?.code, "ServiceUnavailableError");
  });
});
