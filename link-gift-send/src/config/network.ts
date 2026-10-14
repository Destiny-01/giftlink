/**
 * Single, fail-closed network configuration.
 *
 * One explicit environment switch drives the whole frontend: the same build runs as a testnet or
 * a mainnet deployment purely from env. The previous code silently defaulted the chain ID, hardcoded
 * two different explorer URLs, and dropped missing configuration on the floor. Here, nothing has a
 * value default: a missing or invalid variable is collected in `configErrors` by name, and `main.tsx`
 * refuses to mount the app while any error remains.
 *
 * Only variable *names* are ever surfaced. Values are never logged or rendered.
 */

import { defineChain, isAddress, zeroAddress, type Chain } from "viem";

export type ArcNetworkName = "testnet" | "mainnet";

export interface NetworkConfig {
  name: string;
  isTestnet: boolean;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  claimCoreAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
  apiUrl: string;
}

export interface ParsedNetworkEnv {
  network: NetworkConfig;
  configErrors: string[];
}

/** The variables this module reads from `import.meta.env`. */
export interface NetworkEnv {
  VITE_ARC_NETWORK?: string;
  VITE_ARC_CHAIN_ID?: string;
  VITE_ARC_RPC_URL?: string;
  VITE_ARC_EXPLORER_URL?: string;
  VITE_API_URL?: string;
  VITE_CLAIM_CORE_ADDRESS?: string;
  VITE_USDC_CONTRACT_ADDRESS?: string;
}

const NETWORKS: Record<ArcNetworkName, { name: string; chainId: number }> = {
  testnet: { name: "Arc Testnet", chainId: 5042002 },
  mainnet: { name: "Arc", chainId: 5042 },
};

const NETWORK_NAMES: readonly ArcNetworkName[] = ["testnet", "mainnet"];

function isNetworkName(value: string): value is ArcNetworkName {
  return (NETWORK_NAMES as readonly string[]).includes(value);
}

function read(value: string | undefined): string {
  return (value ?? "").trim();
}

/** A usable contract address: a real 0x-address and not the zero address. */
function isUsableAddress(value: string): value is `0x${string}` {
  return value.length > 0 && isAddress(value) && value !== zeroAddress;
}

/**
 * Pure parser: given an env record, produce the resolved network plus the names of any missing or
 * invalid variables. Kept free of `import.meta.env` so a plain runtime test can execute it.
 */
export function parseNetworkEnv(env: NetworkEnv): ParsedNetworkEnv {
  const configErrors: string[] = [];

  const rawNetwork = read(env.VITE_ARC_NETWORK);
  const networkName: ArcNetworkName = isNetworkName(rawNetwork)
    ? rawNetwork
    : "testnet";
  if (!isNetworkName(rawNetwork)) {
    configErrors.push("VITE_ARC_NETWORK");
  }
  const facts = NETWORKS[networkName];

  // VITE_ARC_CHAIN_ID is optional, but when present it must agree with the selected network.
  const chainId = facts.chainId;
  const rawChainId = read(env.VITE_ARC_CHAIN_ID);
  if (rawChainId) {
    const parsed = Number(rawChainId);
    if (!Number.isInteger(parsed) || parsed !== chainId) {
      configErrors.push("VITE_ARC_CHAIN_ID");
    }
  }

  const rpcUrl = read(env.VITE_ARC_RPC_URL);
  if (!rpcUrl) configErrors.push("VITE_ARC_RPC_URL");

  // Normalized to have no trailing slash so URL building is unambiguous.
  const explorerUrl = read(env.VITE_ARC_EXPLORER_URL).replace(/\/+$/, "");
  if (!explorerUrl) configErrors.push("VITE_ARC_EXPLORER_URL");

  const apiUrl = read(env.VITE_API_URL);
  if (!apiUrl) configErrors.push("VITE_API_URL");

  const claimCoreAddress = read(env.VITE_CLAIM_CORE_ADDRESS);
  if (!isUsableAddress(claimCoreAddress)) configErrors.push("VITE_CLAIM_CORE_ADDRESS");

  const usdcAddress = read(env.VITE_USDC_CONTRACT_ADDRESS);
  if (!isUsableAddress(usdcAddress)) configErrors.push("VITE_USDC_CONTRACT_ADDRESS");

  return {
    network: {
      name: facts.name,
      isTestnet: networkName === "testnet",
      chainId,
      rpcUrl,
      explorerUrl,
      claimCoreAddress: claimCoreAddress as `0x${string}`,
      usdcAddress: usdcAddress as `0x${string}`,
      apiUrl,
    },
    configErrors,
  };
}

// `import.meta.env` is undefined under the Node test runner, so read it defensively rather than
// assuming a bundler. When it is absent, every required variable is reported as an error.
const runtimeEnv = ((import.meta as unknown as { env?: NetworkEnv }).env ??
  {}) as NetworkEnv;

const parsed = parseNetworkEnv(runtimeEnv);

export const network: NetworkConfig = parsed.network;

/** Names of the missing or invalid variables. Empty means the configuration is usable. */
export const configErrors: string[] = parsed.configErrors;

/**
 * The one chain definition the app uses, for wagmi and Privy alike. Native currency is USDC with
 * 18 decimals, per Arc (the ERC-20 USDC interface is 6 decimals; the two are distinct).
 */
export const viemChain: Chain = defineChain({
  id: network.chainId,
  name: network.name,
  nativeCurrency: {
    decimals: 18,
    name: "USDC",
    symbol: "USDC",
  },
  rpcUrls: {
    default: {
      http: [network.rpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: `${network.name} Explorer`,
      url: network.explorerUrl,
    },
  },
});
