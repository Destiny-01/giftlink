import { Wallet } from "ethers";
import { env } from "./env";

export const backendSigner = new Wallet(env.BACKEND_SIGNER_PRIVATE_KEY);

if (
  backendSigner.address.toLowerCase() !==
  env.BACKEND_SIGNER_ADDRESS.toLowerCase()
) {
  throw new Error(
    "BACKEND_SIGNER_ADDRESS does not match the derived address of BACKEND_SIGNER_PRIVATE_KEY"
  );
}

export const relayerWallet = new Wallet(env.RELAYER_PRIVATE_KEY);

if (relayerWallet.address.toLowerCase() !== env.RELAYER_ADDRESS.toLowerCase()) {
  throw new Error(
    "RELAYER_ADDRESS does not match the derived address of RELAYER_PRIVATE_KEY"
  );
}
