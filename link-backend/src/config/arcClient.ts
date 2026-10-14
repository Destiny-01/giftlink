import { JsonRpcProvider } from "ethers";
import { env } from "./env";

export const rpcProvider = new JsonRpcProvider(env.RPC_URL);

export function getRpcProvider(): JsonRpcProvider {
  return rpcProvider;
}

let indexerProvider: JsonRpcProvider | null = null;

/**
 * The Claim Core indexer's provider, pinned to `CHAIN_ID`.
 *
 * A provider without a static network sends an extra `eth_chainId` alongside every request to
 * detect network changes, which doubles a catch-up's request count against a rate-limited public
 * endpoint. The indexer instead verifies the chain once per pass (`assertIndexerChainId`).
 */
export function getIndexerProvider(): JsonRpcProvider {
  if (!indexerProvider) {
    indexerProvider = new JsonRpcProvider(env.RPC_URL, env.CHAIN_ID, {
      staticNetwork: true,
    });
  }
  return indexerProvider;
}
