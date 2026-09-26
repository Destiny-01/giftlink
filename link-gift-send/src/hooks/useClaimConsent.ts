/**
 * useClaimConsent - claimant consent signing.
 *
 * The claimant signs the `ClaimRequest` with their selected payout wallet. This is the only
 * signature that chooses the destination; the issuer approver and the Resolver later sign an
 * `Approval` that is bound to this consent by its digest.
 *
 * Mirrors `useCreateDrop.ts`: wagmi/viem for external wallets, Privy for the embedded wallet.
 */

import { useCallback, useState } from "react";
import { useSignTypedData as useWagmiSignTypedData } from "wagmi";
import { useSignTypedData as usePrivySignTypedData } from "@privy-io/react-auth";
import * as api from "@/services/api";
import {
  assertCampaignContract,
  buildClaimRequestMessage,
  claimRequestDigest,
  defaultConsentDeadline,
  getClaimConsentTypedData,
  getClaimCoreDomain,
} from "@/lib/claimCore";
import type {
  CampaignPublicView,
  SigningWallet,
  SubmitConsentResponse,
} from "@/types/nomine";

export interface SignConsentInput {
  campaign: CampaignPublicView;
  entitlementId: `0x${string}`;
  wallet: SigningWallet;
  /** Per-entitlement allocation in USDC base units. */
  amount: string;
  /** Absolute unix seconds. Defaults to now + 1h, capped at the campaign expiry. */
  deadline?: number;
}

export function useClaimConsent() {
  const { signTypedDataAsync } = useWagmiSignTypedData();
  const { signTypedData: privySignTypedData } = usePrivySignTypedData();

  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Build the exact typed data that will be signed. Exposed so the UI can show the deadline,
   * wallet, amount, chain and contract before asking for a signature.
   */
  const buildTypedData = useCallback((input: SignConsentInput) => {
    const cfg = assertCampaignContract(input.campaign.contractAddress);
    const domain = getClaimCoreDomain({
      chainId: input.campaign.chainId ?? cfg.chainId,
      verifyingContract: (input.campaign.contractAddress as `0x${string}`) ?? cfg.address,
    });
    const deadline =
      input.deadline ?? defaultConsentDeadline(input.campaign.expiryTime);
    const request = buildClaimRequestMessage({
      campaignId: input.campaign.onchainId ?? 0,
      entitlementId: input.entitlementId,
      wallet: input.wallet.address,
      amount: input.amount,
      deadline,
    });
    return {
      domain,
      request,
      deadline,
      typedData: getClaimConsentTypedData(request, domain),
      digest: claimRequestDigest(request, domain),
    };
  }, []);

  const signConsent = useCallback(
    async (input: SignConsentInput): Promise<SubmitConsentResponse> => {
      setIsSigning(true);
      setError(null);

      try {
        if (!input.wallet?.address) {
          throw new Error("Select a payout wallet before signing");
        }

        const built = buildTypedData(input);
        const { typedData } = built;

        let signature: string;
        if (input.wallet.walletType === "privy") {
          // @ts-expect-error - Privy returns the signature string for the embedded wallet
          signature = await privySignTypedData({
            domain: typedData.domain,
            types: typedData.types,
            primaryType: typedData.primaryType,
            message: typedData.message,
          });
        } else {
          // @ts-expect-error - viem infers domain/types; permissive in this project
          signature = await signTypedDataAsync({
            domain: typedData.domain,
            types: typedData.types,
            primaryType: typedData.primaryType,
            message: typedData.message,
            account: input.wallet.address,
          });
        }

        if (!signature) {
          throw new Error("No signature was produced");
        }

        const result = await api.submitNomineConsent(input.campaign.id, {
          entitlementId: input.entitlementId,
          walletAddress: input.wallet.address,
          amount: input.amount,
          deadline: built.deadline,
          signature,
        });

        return result;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to sign consent";
        setError(message);
        throw err;
      } finally {
        setIsSigning(false);
      }
    },
    [buildTypedData, privySignTypedData, signTypedDataAsync]
  );

  return {
    signConsent,
    buildTypedData,
    isSigning,
    error,
  };
}
