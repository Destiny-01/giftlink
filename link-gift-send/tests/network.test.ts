/**
 * Runtime tests for the single, fail-closed network configuration.
 *
 * These execute `parseNetworkEnv` directly with real env records, so they do not depend on Vite or
 * a browser. Losing the fail-closed behaviour (a silent default, an unchecked address, a trailing
 * slash) would mount the app against the wrong network, which is exactly what this module exists to
 * prevent.
 *
 * Run with: npm test  (node --test, TypeScript stripped natively)
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parseNetworkEnv } from "../src/config/network.ts";

const TESTNET_ENV = {
  VITE_ARC_NETWORK: "testnet",
  VITE_ARC_RPC_URL: "https://rpc.example.invalid",
  VITE_ARC_EXPLORER_URL: "https://explorer.example.invalid",
  VITE_API_URL: "https://api.example.invalid",
  VITE_CLAIM_CORE_ADDRESS: "0x9D390dCa06118302C8194CC214Ed9BC7f5969810",
  VITE_USDC_CONTRACT_ADDRESS: "0x3600000000000000000000000000000000000000",
};

const MAINNET_ENV = {
  ...TESTNET_ENV,
  VITE_ARC_NETWORK: "mainnet",
};

function withEnv(overrides: Record<string, string | undefined>) {
  return { ...TESTNET_ENV, ...overrides };
}

test("a valid testnet config resolves chain 5042002 with no errors", () => {
  const { network, configErrors } = parseNetworkEnv(TESTNET_ENV);
  assert.equal(network.chainId, 5042002);
  assert.equal(network.name, "Arc Testnet");
  assert.equal(network.isTestnet, true);
  assert.deepEqual(configErrors, []);
});

test("a valid mainnet config resolves chain 5042", () => {
  const { network, configErrors } = parseNetworkEnv(MAINNET_ENV);
  assert.equal(network.chainId, 5042);
  assert.equal(network.name, "Arc");
  assert.equal(network.isTestnet, false);
  assert.deepEqual(configErrors, []);
});

test("a missing RPC URL is reported by name, with no value default", () => {
  const { network, configErrors } = parseNetworkEnv(
    withEnv({ VITE_ARC_RPC_URL: undefined })
  );
  assert.ok(configErrors.includes("VITE_ARC_RPC_URL"));
  // No silent fallback: an absent variable yields an empty value.
  assert.equal(network.rpcUrl, "");
});

test("a VITE_ARC_CHAIN_ID that disagrees with the network is an error", () => {
  const { configErrors } = parseNetworkEnv(withEnv({ VITE_ARC_CHAIN_ID: "999" }));
  assert.ok(configErrors.includes("VITE_ARC_CHAIN_ID"));
});

test("a matching VITE_ARC_CHAIN_ID is accepted", () => {
  const { configErrors } = parseNetworkEnv(
    withEnv({ VITE_ARC_CHAIN_ID: "5042002" })
  );
  assert.ok(!configErrors.includes("VITE_ARC_CHAIN_ID"));
});

test("a malformed address is reported by name, and never includes its value", () => {
  const bad = "0xnot-an-address";
  const { configErrors } = parseNetworkEnv(
    withEnv({ VITE_USDC_CONTRACT_ADDRESS: bad })
  );
  assert.ok(configErrors.includes("VITE_USDC_CONTRACT_ADDRESS"));
  assert.ok(!configErrors.some((name) => name.includes(bad)));
});

test("a missing VITE_ARC_NETWORK is an error", () => {
  const { configErrors } = parseNetworkEnv(
    withEnv({ VITE_ARC_NETWORK: undefined })
  );
  assert.ok(configErrors.includes("VITE_ARC_NETWORK"));
});

test("an explorer URL with a trailing slash is normalized", () => {
  const { network, configErrors } = parseNetworkEnv(
    withEnv({ VITE_ARC_EXPLORER_URL: "https://explorer.example.invalid/" })
  );
  assert.equal(network.explorerUrl, "https://explorer.example.invalid");
  assert.deepEqual(configErrors, []);
});
