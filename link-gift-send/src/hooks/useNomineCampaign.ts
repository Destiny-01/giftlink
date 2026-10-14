/**
 * useNomineCampaign - issuer-side campaign lifecycle.
 *
 * Prepares a DRAFT (server assigns high-entropy entitlement identifiers), funds it with USDC via the
 * connected wallet (approve -> createCampaign), confirms against the canonical CampaignFunded event,
 * signs the `Approval` from the distinct external issuer-approval wallet, and recovers after expiry.
 *
 * Mirrors `useCreateDrop.ts`: wagmi/viem for external wallets, Privy for the embedded wallet.
 */

import { useCallback, useEffect, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { encodeFunctionData, parseEventLogs } from "viem";
import * as api from "@/services/api";
import { claimCoreAbi } from "@/lib/claimCoreAbi";
import {
  clearPendingFunding,
  readPendingFunding,
  recordPendingFunding,
} from "@/lib/pendingFunding";
import {
  assertCampaignContract,
  assertClaimCoreChain,
  buildApprovalMessage,
  encodeCreateCampaignData,
  encodeReclaimData,
  getApprovalTypedData,
  getClaimCoreConfig,
  USDC_ADDRESS,
} from "@/lib/claimCore";
import type {
  IssuerApprovalRequest,
  IssuerApprovalRequestResponse,
  NomineCampaign,
  PrepareCampaignRequest,
  PrepareCampaignResponse,
  SigningWallet,
} from "@/types/nomine";

// ERC20 ABI for approve/allowance (USDC ERC-20 interface).
const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type FundStep =
  | "idle"
  | "approving"
  | "creating"
  | "confirming"
  | "funded";

// ---------------------------------------------------------------------------
// Issuer: campaign list
// ---------------------------------------------------------------------------
export function useNomineCampaigns() {
  const [campaigns, setCampaigns] = useState<NomineCampaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getNomineCampaigns();
      setCampaigns(data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load campaigns");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { campaigns, isLoading, error, refresh };
}

// ---------------------------------------------------------------------------
// Issuer: single campaign detail + approval requests (polled)
// ---------------------------------------------------------------------------
export function useNomineCampaignDetail(
  campaignId?: string,
  options?: { pollMs?: number }
) {
  const pollMs = options?.pollMs ?? 20000;
  const [campaign, setCampaign] = useState<NomineCampaign | null>(null);
  const [requests, setRequests] = useState<IssuerApprovalRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!campaignId) return;
    setError(null);
    try {
      const [detail, requestList] = await Promise.all([
        api.getNomineCampaign(campaignId),
        api
          .getNomineCampaignRequests(campaignId)
          .catch(() => ({ requests: [] })),
      ]);
      setCampaign(detail ?? null);
      setRequests(requestList?.requests ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load campaign");
    } finally {
      setIsLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    setIsLoading(true);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!campaignId || !pollMs) return;
    const handle = setInterval(() => {
      refresh();
    }, pollMs);
    return () => clearInterval(handle);
  }, [campaignId, pollMs, refresh]);

  return { campaign, requests, isLoading, error, refresh };
}

// ---------------------------------------------------------------------------
// Issuer: prepare (DRAFT)
// ---------------------------------------------------------------------------
export function usePrepareNomineCampaign() {
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prepare = useCallback(
    async (payload: PrepareCampaignRequest): Promise<PrepareCampaignResponse> => {
      setIsPreparing(true);
      setError(null);
      try {
        const result = await api.prepareNomineCampaign(payload);
        return result;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to prepare campaign");
        throw err;
      } finally {
        setIsPreparing(false);
      }
    },
    []
  );

  return { prepare, isPreparing, error };
}

// ---------------------------------------------------------------------------
// Issuer: funding (approve -> createCampaign -> confirm)
// ---------------------------------------------------------------------------
export function useFundNomineCampaign() {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { sendTransaction } = usePrivy();
  const { chainId, address } = useAccount();

  const [step, setStep] = useState<FundStep>("idle");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fund = useCallback(
    async (
      prepared: PrepareCampaignResponse,
      wallet: SigningWallet
    ): Promise<{ campaignId: string; onchainId: string; status: string } | null> => {
      setIsLoading(true);
      setError(null);
      setStep("approving");

      try {
        if (!publicClient) throw new Error("Public client not available");
        if (!wallet?.address) throw new Error("Select a wallet to fund from");

        // Fail closed: wallet chain must match the configured Claim Core chain.
        const activeChainId = wallet.walletType === "external" ? chainId : chainId;
        const cfg = assertClaimCoreChain(activeChainId);

        const budget = BigInt(prepared.budget);
        const config = prepared.config;
        const struct = {
          issuerApprover: config.issuerApprover,
          resolver: config.resolver,
          allocation: BigInt(config.allocation),
          openingTime: BigInt(config.openingTime),
          expiryTime: BigInt(config.expiryTime),
          entitlementIds: config.entitlementIds,
        };

        // Reconcile a previously broadcast funding transaction before creating anything. The roster
        // is immutable, so a second createCampaign would escrow a second campaign that this draft
        // could never bind, leaving that allocation reachable only by a manual reclaim.
        const previouslyBroadcast = readPendingFunding(prepared.campaignId)?.txHash as
          | `0x${string}`
          | undefined;

        let txHash: `0x${string}`;

        if (previouslyBroadcast) {
          txHash = previouslyBroadcast;
          setStep("confirming");
        } else {
          // Step 1: approve USDC to the Claim Core for the full budget.
          // @ts-expect-error - wagmi types require authorizationList but it is optional at runtime
          const allowance: bigint = await publicClient.readContract({
            address: USDC_ADDRESS,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [wallet.address, cfg.address],
          });

          if (allowance < budget) {
            if (wallet.walletType === "external") {
              // @ts-expect-error - wagmi infers chain and account from context
              const approveHash = await writeContractAsync({
                address: USDC_ADDRESS,
                abi: ERC20_ABI,
                functionName: "approve",
                args: [cfg.address, budget],
              });
              const approvalReceipt = await publicClient.waitForTransactionReceipt({
                hash: approveHash,
              });
              if (approvalReceipt.status === "reverted") {
                throw new Error("USDC approval failed");
              }
            } else {
              if (!sendTransaction) throw new Error("sendTransaction not available");
              const approveData = encodeFunctionData({
                abi: ERC20_ABI,
                functionName: "approve",
                args: [cfg.address, budget],
              });
              const approveTx = await sendTransaction({
                to: USDC_ADDRESS,
                data: approveData,
              });
              const approvalReceipt = await publicClient.waitForTransactionReceipt({
                hash: approveTx.hash as `0x${string}`,
              });
              if (approvalReceipt.status === "reverted") {
                throw new Error("USDC approval failed");
              }
            }
          }

          // Step 2: createCampaign(config).
          setStep("creating");

          if (wallet.walletType === "external") {
            // @ts-expect-error - wagmi infers chain and account from context
            txHash = await writeContractAsync({
              address: cfg.address,
              abi: claimCoreAbi,
              functionName: "createCampaign",
              args: [struct],
            });
          } else {
            if (!sendTransaction) throw new Error("sendTransaction not available");
            const data = encodeCreateCampaignData(struct);
            const tx = await sendTransaction({ to: cfg.address, data });
            txHash = tx.hash as `0x${string}`;
          }

          // Persist the hash *before* waiting for the receipt: if this tab dies now, the next
          // attempt must reconcile this transaction instead of creating another campaign.
          recordPendingFunding({
            campaignId: prepared.campaignId,
            txHash,
            startedAt: new Date().toISOString(),
          });
        }

        // Step 3: wait for the canonical CampaignFunded event.
        setStep("confirming");
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status === "reverted") {
          // The attempt is over: a retry must create a fresh campaign rather than re-confirm this.
          clearPendingFunding(prepared.campaignId);
          throw new Error("createCampaign reverted on-chain");
        }

        try {
          parseEventLogs({ abi: claimCoreAbi, logs: receipt.logs, strict: false });
        } catch {
          // Event parsing is advisory only; the backend re-verifies the canonical event.
        }

        // Step 4: confirm with the backend. "funded" is only shown after this returns.
        const confirmed = await api.confirmNomineCampaign(
          prepared.campaignId,
          txHash
        );

        clearPendingFunding(prepared.campaignId);
        setStep("funded");
        return confirmed;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to fund campaign");
        setStep("idle");
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [publicClient, writeContractAsync, sendTransaction, chainId, address]
  );

  const reset = useCallback(() => {
    setStep("idle");
    setError(null);
  }, []);

  return { fund, step, isLoading, error, reset };
}

// ---------------------------------------------------------------------------
// Issuer: approve a request from the distinct external approval wallet
// ---------------------------------------------------------------------------
export function useIssuerApproval() {
  const { signTypedDataAsync } = useSignTypedData();
  const { address } = useAccount();

  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildTypedData = useCallback(
    (campaign: NomineCampaign, request: IssuerApprovalRequest) => {
      assertCampaignContract(campaign.contractAddress);
      if (!request.consentDigest) {
        throw new Error("Request has no consent digest; refusing to approve");
      }
      const approval = buildApprovalMessage(
        {
          campaignId: campaign.onchainId ?? 0,
          entitlementId: request.entitlementId,
          wallet: request.walletAddress as `0x${string}`,
          amount: request.amount,
          deadline: request.deadline,
        },
        request.consentDigest
      );
      return getApprovalTypedData(approval);
    },
    []
  );

  const signApproval = useCallback(
    async (
      campaign: NomineCampaign,
      request: IssuerApprovalRequest
    ): Promise<IssuerApprovalRequestResponse> => {
      setIsSigning(true);
      setError(null);

      try {
        // The approval wallet must be the distinct external address configured at funding time.
        if (!address) {
          throw new Error("Connect the external issuer-approval wallet to sign");
        }
        if (
          address.toLowerCase() !== campaign.issuerApproverAddress.toLowerCase()
        ) {
          throw new Error(
            "The connected wallet is not this campaign's issuer-approval address"
          );
        }
        getClaimCoreConfig();

        const typedData = buildTypedData(campaign, request);

        const signature: string = await signTypedDataAsync({
          domain: typedData.domain,
          types: typedData.types,
          primaryType: typedData.primaryType,
          message: typedData.message,
          account: address,
        });

        if (!signature) throw new Error("No signature was produced");

        return await api.submitNomineIssuerApproval(
          campaign.id,
          request.id,
          signature
        );
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to sign approval";
        setError(message);
        throw err;
      } finally {
        setIsSigning(false);
      }
    },
    [address, buildTypedData, signTypedDataAsync]
  );

  return { signApproval, buildTypedData, isSigning, error };
}

// ---------------------------------------------------------------------------
// Issuer: recover after expiry (no approver needed)
// ---------------------------------------------------------------------------
export function useRecoverNomineCampaign() {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { sendTransaction } = usePrivy();

  const [isRecovering, setIsRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recover = useCallback(
    async (campaign: NomineCampaign, wallet: SigningWallet) => {
      setIsRecovering(true);
      setError(null);
      try {
        if (!publicClient) throw new Error("Public client not available");
        if (campaign.onchainId === null || campaign.onchainId === undefined) {
          throw new Error("Campaign has no on-chain id");
        }
        const cfg = getClaimCoreConfig();

        let txHash: `0x${string}`;
        if (wallet.walletType === "external") {
          // @ts-expect-error - wagmi infers chain and account from context
          txHash = await writeContractAsync({
            address: cfg.address,
            abi: claimCoreAbi,
            functionName: "reclaim",
            args: [BigInt(campaign.onchainId)],
          });
        } else {
          if (!sendTransaction) throw new Error("sendTransaction not available");
          const data = encodeReclaimData(campaign.onchainId);
          const tx = await sendTransaction({ to: cfg.address, data });
          txHash = tx.hash as `0x${string}`;
        }

        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status === "reverted") {
          throw new Error("reclaim reverted on-chain");
        }

        return await api.confirmNomineRecovery(campaign.id, txHash);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to recover funds";
        setError(message);
        throw err;
      } finally {
        setIsRecovering(false);
      }
    },
    [publicClient, writeContractAsync, sendTransaction]
  );

  return { recover, isRecovering, error };
}
