/**
 * Explicit Arc network configuration.
 *
 * These values are the only chain parameters this project accepts. They are never
 * defaulted and never inferred: if the environment does not name a network, or the
 * live chain does not match the expected chain ID and USDC contract, deployment
 * stops. See `scripts/deploy.ts` for the fail-closed preflight.
 *
 * Sources (verify against the official reference before spending anything):
 * - Chain IDs and USDC addresses: https://docs.arc.io/arc/references/contract-addresses
 *   and Circle's stablecoin contract-address table
 *   (https://developers.circle.com/stablecoins/usdc-contract-addresses).
 * - Arc testnet USDC is the ERC-20 interface at the native-USDC system address
 *   `0x3600...0000`, which Circle lists for both Arc testnet and Arc mainnet.
 *
 * The RPC URL is deliberately *not* hardcoded: an operator supplies it through the
 * environment variable named below so a stale or third-party endpoint cannot become
 * a silent default.
 */

export interface ArcNetworkConfig {
  /** EVM chain ID expected from `eth_chainId`. */
  readonly chainId: number;
  /** USDC ERC-20 contract expected at deployment. */
  readonly usdc: string;
  /** USDC ERC-20 decimals expected from `decimals()`. */
  readonly usdcDecimals: number;
  /** Block explorer base URL used to build human-readable links. */
  readonly explorer: string;
  /** Environment variable that must hold the JSON-RPC endpoint. */
  readonly rpcEnv: string;
}

export const ARC_NETWORKS = {
  testnet: {
    chainId: 5042002,
    usdc: "0x3600000000000000000000000000000000000000",
    usdcDecimals: 6,
    explorer: "https://testnet.arcscan.app",
    rpcEnv: "ARC_TESTNET_RPC_URL",
  },
  mainnet: {
    chainId: 5042,
    usdc: "0x3600000000000000000000000000000000000000",
    usdcDecimals: 6,
    explorer: "https://explorer.arc.io",
    rpcEnv: "ARC_MAINNET_RPC_URL",
  },
} as const satisfies Record<string, ArcNetworkConfig>;

export type ArcNetworkName = keyof typeof ARC_NETWORKS;

export function isArcNetworkName(value: string): value is ArcNetworkName {
  return value === "testnet" || value === "mainnet";
}

/** Base unit conversion for a human USDC amount, e.g. 25 -> 25000000n for 6 decimals. */
export function toUsdcBaseUnits(amount: string, decimals: number): bigint {
  const [wholePart = "", fraction = ""] = amount.split(".");
  const whole = wholePart === "" ? "0" : wholePart;
  if (!/^[0-9]+$/.test(whole) || !/^[0-9]*$/.test(fraction)) {
    throw new Error(`USDC amount ${amount} is not a plain decimal number`);
  }
  if (fraction.length > decimals) {
    throw new Error(`USDC amount ${amount} has more than ${decimals} decimals`);
  }
  const padded = fraction.padEnd(decimals, "0");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded === "" ? "0" : padded);
}
