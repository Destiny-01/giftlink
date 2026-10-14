import "./setup";
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const { parseEnv, ARC_NETWORK_CHAIN_IDS, TEST_CHAIN_ID } =
  require("../src/config/env") as typeof import("../src/config/env");

/**
 * A valid configuration with no network-specific constraints met, so each case can add the
 * one thing under test. `NODE_ENV=production` keeps the test-chain exception out of the way
 * unless a case opts into it.
 */
function baseRaw(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    PORT: "4000",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/giftlink",
    RPC_URL: "https://rpc.example.test",
    ARC_NETWORK: "testnet",
    CHAIN_ID: String(ARC_NETWORK_CHAIN_IDS.testnet),
    CLAIM_CORE_CONTRACT_ADDRESS: "0x" + "33".repeat(20),
    CLAIM_CORE_DEPLOY_BLOCK: "64110120",
    USDC_CONTRACT_ADDRESS: "0x" + "22".repeat(20),
    BACKEND_SIGNER_PRIVATE_KEY: "0x" + "11".repeat(32),
    BACKEND_SIGNER_ADDRESS: "0x" + "44".repeat(20),
    RELAYER_PRIVATE_KEY: "0x" + "22".repeat(32),
    RELAYER_ADDRESS: "0x" + "55".repeat(20),
    SERVER_PEPPER: "0x" + "33".repeat(32),
    PRIVY_APP_ID: "cltest0000000000000000000",
    PRIVY_APP_SECRET: "test-app-secret",
    FRONTEND_URL: "http://localhost:5173",
    ...overrides,
  };
}

/** A mainnet configuration that satisfies every mainnet requirement. */
function mainnetRaw(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return baseRaw({
    ARC_NETWORK: "mainnet",
    CHAIN_ID: String(ARC_NETWORK_CHAIN_IDS.mainnet),
    ISSUER_ALLOWLIST: "did:privy:abc",
    MAX_CAMPAIGN_BUDGET_USDC: "100",
    MAX_CAMPAIGN_RECIPIENTS: "50",
    ...overrides,
  });
}

/** Asserts parseEnv throws and that the message names each expected variable. */
function expectFailure(raw: NodeJS.ProcessEnv, names: string[]): string {
  try {
    parseEnv(raw);
    assert.fail("expected parseEnv to throw");
  } catch (error) {
    const message = (error as Error).message;
    for (const name of names) {
      assert.ok(
        message.includes(name),
        `expected the error to name ${name}, got: ${message}`
      );
    }
    return message;
  }
}

describe("parseEnv", () => {
  test("a valid testnet config with no allowlist or caps succeeds", () => {
    const parsed = parseEnv(baseRaw());

    assert.equal(parsed.ARC_NETWORK, "testnet");
    assert.equal(parsed.CHAIN_ID, ARC_NETWORK_CHAIN_IDS.testnet);
    assert.deepEqual(parsed.ISSUER_ALLOWLIST, []);
    assert.equal(parsed.MAX_CAMPAIGN_BUDGET_USDC, undefined);
    assert.equal(parsed.MAX_CAMPAIGN_RECIPIENTS, undefined);
    assert.equal(parsed.ENABLE_LEGACY_GIFTLINK, false);
  });

  test("a valid mainnet config with allowlist, caps and legacy off succeeds", () => {
    const parsed = parseEnv(mainnetRaw());

    assert.equal(parsed.ARC_NETWORK, "mainnet");
    assert.equal(parsed.CHAIN_ID, ARC_NETWORK_CHAIN_IDS.mainnet);
    assert.deepEqual(parsed.ISSUER_ALLOWLIST, ["did:privy:abc"]);
    assert.equal(parsed.MAX_CAMPAIGN_BUDGET_USDC, "100");
    assert.equal(parsed.MAX_CAMPAIGN_RECIPIENTS, 50);
  });

  test("mainnet with an empty allowlist fails, naming ISSUER_ALLOWLIST", () => {
    expectFailure(mainnetRaw({ ISSUER_ALLOWLIST: "" }), ["ISSUER_ALLOWLIST"]);
    expectFailure(mainnetRaw({ ISSUER_ALLOWLIST: " , ," }), ["ISSUER_ALLOWLIST"]);
  });

  test("mainnet with legacy enabled fails, naming ENABLE_LEGACY_GIFTLINK", () => {
    expectFailure(mainnetRaw({ ENABLE_LEGACY_GIFTLINK: "true" }), [
      "ENABLE_LEGACY_GIFTLINK",
    ]);
  });

  test("mainnet with no caps fails, naming both cap variables", () => {
    expectFailure(
      mainnetRaw({ MAX_CAMPAIGN_BUDGET_USDC: "", MAX_CAMPAIGN_RECIPIENTS: "" }),
      ["MAX_CAMPAIGN_BUDGET_USDC", "MAX_CAMPAIGN_RECIPIENTS"]
    );
  });

  test("a network and chain id mismatch fails, naming CHAIN_ID", () => {
    expectFailure(baseRaw({ CHAIN_ID: String(ARC_NETWORK_CHAIN_IDS.mainnet) }), [
      "CHAIN_ID",
    ]);
  });

  test("legacy enabled without a GiftLink address fails, naming GIFTLINK_CONTRACT_ADDRESS", () => {
    expectFailure(
      baseRaw({ ENABLE_LEGACY_GIFTLINK: "true", GIFTLINK_CONTRACT_ADDRESS: "" }),
      ["GIFTLINK_CONTRACT_ADDRESS"]
    );
  });

  test("the test chain id is accepted only while NODE_ENV=test", () => {
    assert.doesNotThrow(() =>
      parseEnv(baseRaw({ NODE_ENV: "test", CHAIN_ID: String(TEST_CHAIN_ID) }))
    );
    expectFailure(baseRaw({ NODE_ENV: "production", CHAIN_ID: String(TEST_CHAIN_ID) }), [
      "CHAIN_ID",
    ]);
  });

  test("the failure message names variables, never their values", () => {
    const secret = "super-secret-value";
    const message = expectFailure(
      baseRaw({ ARC_NETWORK: secret, SERVER_PEPPER: secret }),
      ["ARC_NETWORK"]
    );
    assert.ok(
      !message.includes(secret),
      `the error message leaked a value: ${message}`
    );
  });
});
