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

/**
 * Derives the Nomine auto-approver signer, or `null` when it is not configured.
 *
 * The contract requires the three authorities to be distinct, so a misconfigured
 * auto-approver (the wrong address, or one shared with the Resolver or the relayer) would
 * only surface as a revert at funding or settlement time. Checking it here fails the
 * process at startup instead, exactly as the configured signer and relayer addresses are
 * checked above. `env.ts` already guarantees the private key and address come as a pair.
 *
 * The parameters are explicit rather than read straight from `env` so the check itself is
 * unit-testable without re-importing the module with a different environment.
 */
export function deriveAutoApproverSigner(input: {
  privateKey: string | undefined;
  address: string | undefined;
  resolverAddress: string;
  relayerAddress: string;
}): Wallet | null {
  if (!input.privateKey) {
    return null;
  }

  const signer = new Wallet(input.privateKey);
  const derived = signer.address.toLowerCase();

  if (!input.address || derived !== input.address.toLowerCase()) {
    throw new Error(
      "AUTO_APPROVER_ADDRESS does not match the derived address of AUTO_APPROVER_PRIVATE_KEY"
    );
  }
  if (derived === input.resolverAddress.toLowerCase()) {
    throw new Error("AUTO_APPROVER_ADDRESS must differ from BACKEND_SIGNER_ADDRESS");
  }
  if (derived === input.relayerAddress.toLowerCase()) {
    throw new Error("AUTO_APPROVER_ADDRESS must differ from RELAYER_ADDRESS");
  }

  return signer;
}

/**
 * The Nomine-held auto-approver key, or `null` when automatic approval is not configured.
 * It is distinct from the Resolver (`backendSigner`) and the relayer by construction above.
 */
export const autoApproverSigner = deriveAutoApproverSigner({
  privateKey: env.AUTO_APPROVER_PRIVATE_KEY,
  address: env.AUTO_APPROVER_ADDRESS,
  resolverAddress: backendSigner.address,
  relayerAddress: relayerWallet.address,
});
