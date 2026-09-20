import { JsonRpcProvider } from "ethers";
import { env } from "./env";

export const rpcProvider = new JsonRpcProvider(env.RPC_URL);

export function getRpcProvider(): JsonRpcProvider {
  return rpcProvider;
}
