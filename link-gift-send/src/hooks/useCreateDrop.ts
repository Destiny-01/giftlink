import { useCallback, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useWriteContract,
  useSignMessage,
} from "wagmi";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { parseUnits, encodeFunctionData, parseEventLogs } from "viem";
import { GiftLinkABI } from "@/lib/abi";
import * as api from "@/services/api";
import { network } from "@/config/network";
import type {
  PrepareDropResponse,
  RelayClaimResponse,
  WalletType,
} from "@/types/gift";

// ERC20 ABI for approve and allowance
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

// Contract addresses from env
const GIFTLINK_CONTRACT_ADDRESS = import.meta.env
  .VITE_GIFTLINK_CONTRACT_ADDRESS as `0x${string}`;

// Types
interface CreateDropPayload {
  recipientType: "public" | "email" | "discord" | "twitter";
  recipientIdentifier: string;
  amount: string; // Human-readable (e.g., "100")
  tokenAddress: string; // USDC contract address (always USDC)
  tokenSymbol: string;
  tokenDecimals: number;
  expiry?: number; // Unix timestamp
  message?: string;
  theme?: string;
  isAnonymous?: boolean;
  senderIdentifier?: string;
  fundingSource: string; // wallet address
}

interface ClaimPermitResponse {
  permit: {
    dropId: number; // On-chain drop ID
    claimer: string;
    expiry: number; // Permit expiry timestamp
  };
  signature: string; // Backend's EIP-712 signature
  dropDetails: {
    amount: string;
    token: string;
    recipientType: string;
  };
}

// API client functions - using service layer
const apiClient = {
  prepareDrop: async (
    payload: CreateDropPayload & {
      senderAddress: string;
      walletType: WalletType;
    }
  ): Promise<PrepareDropResponse> => {
    return api.prepareDrop(payload);
  },

  confirmDrop: async (dropId: string, onchainId: number, txHash: string) => {
    return api.confirmDrop(dropId, onchainId, txHash);
  },

  getClaimPermit: async (
    dropId: string,
    claimerAddress: string,
    claimerIdentifier?: string,
    walletType: string = "external"
  ): Promise<ClaimPermitResponse> => {
    return api.getClaimPermit(
      dropId,
      claimerAddress,
      claimerIdentifier,
      walletType
    ) as Promise<ClaimPermitResponse>;
  },

  confirmClaim: async (
    dropId: string,
    txHash: string,
    claimerAddress: string,
    walletType: string
  ) => {
    return api.confirmClaim(dropId, txHash, claimerAddress, walletType);
  },
};

// ========================================
// CREATE DROP HOOK (External Wallets)
// ========================================
export function useCreateDrop() {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<
    "idle" | "preparing" | "approving" | "signing" | "confirming"
  >("idle");

  const createDrop = useCallback(
    async (payload: CreateDropPayload, address: `0x${string}`) => {
      setIsLoading(true);
      setError(null);
      setStep("preparing");

      try {
        // Step 1: Prepare drop with backend (get commitment)
        const prepareResult = await apiClient.prepareDrop({
          ...payload,
          fundingSource: address,
          senderAddress: address,
          walletType: "external",
        });

        const { dropId, contractParams, gasTankAmount } = prepareResult;

        let onchainDropId: bigint;

        // Step 2: USDC-only flow with gas tank
        const tokenAddress = network.usdcAddress;
        const amountWei = parseUnits(payload.amount, payload.tokenDecimals);
        // Backend returns gasTankAmount in wei format (6 decimals for USDC ERC-20)
        const gasTankAmountWei = BigInt(gasTankAmount as `0x${string}`);
        const totalAmountWei = amountWei + gasTankAmountWei;

        // Step 2a: Check allowance
        // @ts-expect-error - wagmi types require authorizationList, but it's optional at runtime
        const allowance = await publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, GIFTLINK_CONTRACT_ADDRESS],
        });

        // Step 2b: Approve if needed (amount + gasTankAmount)
        if (allowance < totalAmountWei) {
          setStep("approving");

          // @ts-expect-error - wagmi infers chain and account from context
          const approveTxHash = await writeContractAsync({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [GIFTLINK_CONTRACT_ADDRESS, totalAmountWei],
          });

          // Wait for approval
          const approvalReceipt = await publicClient.waitForTransactionReceipt({
            hash: approveTxHash,
          });

          if (approvalReceipt.status === "reverted") {
            throw new Error("Token approval failed");
          }
        }

        // Step 2c: Create drop with amount and gasTankAmount
        setStep("signing");

        // Estimate gas first
        const estimatedGas = await publicClient.estimateGas({
          account: address,
          to: GIFTLINK_CONTRACT_ADDRESS,
          data: encodeFunctionData({
            abi: GiftLinkABI,
            functionName: "createDrop",
            args: [
              BigInt(amountWei.toString()),
              gasTankAmountWei,
              contractParams.recipientCommit as `0x${string}`,
              contractParams.recipientType,
              BigInt(contractParams.expiry),
            ],
          }),
        });

        // Add 20% buffer to estimated gas
        const gasLimit = (estimatedGas * 120n) / 100n;

        // @ts-expect-error - wagmi infers chain and account from context
        const txHash = await writeContractAsync({
          address: GIFTLINK_CONTRACT_ADDRESS,
          abi: GiftLinkABI,
          functionName: "createDrop",
          args: [
            BigInt(amountWei.toString()),
            gasTankAmountWei,
            contractParams.recipientCommit as `0x${string}`,
            contractParams.recipientType,
            BigInt(contractParams.expiry),
          ],
          gas: gasLimit,
        });

        // Step 3: Wait for confirmation
        setStep("confirming");
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });

        if (receipt.status === "reverted") {
          throw new Error("Transaction failed on-chain");
        }

        // Step 4: Extract on-chain drop ID from event
        // Use parseEventLogs to parse events from GiftLink contract
        try {
          const parsedLogs = parseEventLogs({
            abi: GiftLinkABI,
            logs: receipt.logs,
            strict: false,
          });

          // Find DropCreated event
          const dropCreatedEvent = parsedLogs.find(
            (log) => log.eventName === "DropCreated"
          );

          if (!dropCreatedEvent) {
            throw new Error(
              `DropCreated event not found in transaction logs. Found ${parsedLogs.length} parsed events.`
            );
          }

          onchainDropId = (dropCreatedEvent.args as { dropId: bigint }).dropId;
        } catch (err) {
          console.error(
            "[createDrop] Error parsing event logs:",
            err instanceof Error ? err.message : "Unknown error"
          );
          throw new Error(
            `Failed to parse DropCreated event from transaction logs: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }

        // Step 5: Confirm with backend
        await apiClient.confirmDrop(dropId, Number(onchainDropId), txHash);

        setIsLoading(false);
        setStep("idle");

        return {
          dropId,
          onchainId: Number(onchainDropId),
          txHash,
        };
      } catch (err: unknown) {
        console.error("[createDrop] Error:", err instanceof Error ? err.message : "Unknown error");
        setError(err instanceof Error ? err.message : "Failed to create drop");
        setIsLoading(false);
        setStep("idle");
        throw err;
      }
    },
    [publicClient, writeContractAsync]
  );

  return {
    createDrop,
    isLoading,
    error,
    step,
  };
}

// ========================================
// CREATE DROP HOOK (Privy Wallets)
// ========================================
export function useCreateDropPrivy() {
  const { user, sendTransaction } = usePrivy();
  const { wallets } = useWallets();
  const publicClient = usePublicClient();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<
    "idle" | "preparing" | "approving" | "signing" | "confirming"
  >("idle");

  const createDrop = useCallback(
    async (payload: CreateDropPayload) => {
      if (!sendTransaction) {
        throw new Error("sendTransaction not available");
      }

      if (!publicClient) {
        throw new Error("Public client not available");
      }

      // Force use of Privy embedded wallet (walletClientType === "privy")
      // user.wallet.address might point to external wallet, so we explicitly find Privy wallet
      const privyWallet = wallets.find((w) => w.walletClientType === "privy");

      if (!privyWallet?.address) {
        throw new Error("Privy embedded wallet not found");
      }

      // Use Privy embedded wallet address - this is the address that should create the drop
      const address = privyWallet.address as `0x${string}`;

      setIsLoading(true);
      setError(null);
      setStep("preparing");

      try {
        // Step 1: Prepare drop with backend
        const prepareResult = await apiClient.prepareDrop({
          ...payload,
          fundingSource: address,
          senderAddress: address,
          walletType: "privy",
        });

        const { dropId, contractParams, gasTankAmount } = prepareResult;

        let onchainDropId: bigint;

        // Step 2: USDC-only flow with gas tank
        const tokenAddress = payload.tokenAddress as `0x${string}`;
        const amountWei = parseUnits(payload.amount, payload.tokenDecimals);
        // Backend returns gasTankAmount in wei format (6 decimals for USDC ERC-20)
        const gasTankAmountWei = BigInt(gasTankAmount as `0x${string}`);
        const totalAmountWei = amountWei + gasTankAmountWei;

        // Step 2a: Check allowance
        // @ts-expect-error - wagmi types require authorizationList, but it's optional at runtime
        const allowance = await publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, GIFTLINK_CONTRACT_ADDRESS],
        });

        // Step 2b: Approve if needed (amount + gasTankAmount)
        if (allowance < totalAmountWei) {
          setStep("approving");

          const approveData = encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [GIFTLINK_CONTRACT_ADDRESS, totalAmountWei],
          });

          const approveTx = await sendTransaction({
            to: tokenAddress,
            data: approveData,
          });

          // Wait for approval
          const approvalReceipt = await publicClient.waitForTransactionReceipt({
            hash: approveTx.hash as `0x${string}`,
          });

          if (approvalReceipt.status === "reverted") {
            throw new Error("Token approval failed");
          }
        }

        // Step 2c: Create drop with amount and gasTankAmount
        setStep("signing");

        const createDropData = encodeFunctionData({
          abi: GiftLinkABI,
          functionName: "createDrop",
          args: [
            BigInt(amountWei),
            BigInt(gasTankAmountWei),
            contractParams.recipientCommit as `0x${string}`,
            contractParams.recipientType,
            BigInt(contractParams.expiry),
          ],
        });

        // Estimate gas first
        const estimatedGas = await publicClient.estimateGas({
          account: address,
          to: GIFTLINK_CONTRACT_ADDRESS,
          data: createDropData,
        });

        // Add 20% buffer to estimated gas
        const gasLimit = (estimatedGas * 120n) / 100n;

        const createTx = await sendTransaction({
          to: GIFTLINK_CONTRACT_ADDRESS,
          data: createDropData,
          gasLimit: gasLimit,
        });

        const txHash = createTx.hash;

        // Step 3: Wait for confirmation
        setStep("confirming");
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash as `0x${string}`,
        });

        if (receipt.status === "reverted") {
          throw new Error("Transaction failed on-chain");
        }

        // Step 4: Extract on-chain drop ID from event
        // Use parseEventLogs to parse events from GiftLink contract
        try {
          const parsedLogs = parseEventLogs({
            abi: GiftLinkABI,
            logs: receipt.logs,
            strict: false,
          });

          // Find DropCreated event
          const dropCreatedEvent = parsedLogs.find(
            (log) => log.eventName === "DropCreated"
          );

          if (!dropCreatedEvent) {
            throw new Error(
              `DropCreated event not found in transaction logs. Found ${parsedLogs.length} parsed events.`
            );
          }

          onchainDropId = (dropCreatedEvent.args as { dropId: bigint }).dropId;
        } catch (err) {
          console.error(
            "[createDropPrivy] Error parsing event logs:",
            err instanceof Error ? err.message : "Unknown error"
          );
          throw new Error(
            `Failed to parse DropCreated event from transaction logs: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }

        // Step 5: Confirm with backend
        await apiClient.confirmDrop(dropId, Number(onchainDropId), txHash);

        setIsLoading(false);
        setStep("idle");

        return {
          dropId,
          onchainId: Number(onchainDropId),
          txHash,
        };
      } catch (err: unknown) {
        console.error("[createDropPrivy] Error:", err instanceof Error ? err.message : "Unknown error");
        setError(err instanceof Error ? err.message : "Failed to create drop");
        setIsLoading(false);
        setStep("idle");
        throw err;
      }
    },
    [wallets, sendTransaction, publicClient]
  );

  return {
    createDrop,
    isLoading,
    error,
    step,
  };
}

// ========================================
// CLAIM DROP HOOK (External Wallets) - Gasless
// ========================================
export function useClaimDrop() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<
    "idle" | "signing" | "relaying" | "recording" | "complete"
  >("idle");

  const claimDrop = useCallback(
    async (dropId: string, onchainId: string, isPublic: boolean = false) => {
      if (!address) {
        throw new Error("Wallet not connected");
      }

      setIsLoading(true);
      setError(null);
      setStep("signing");

      try {
        // Step 1: Sign authorization message (FREE - no gas, no transaction)
        const timestamp = Math.floor(Date.now() / 1000);
        const message = `GiftLink Claim Authorization
Drop ID: ${onchainId}
Claimer: ${address}
Timestamp: ${timestamp}`;

        const signature = await signMessageAsync({
          account: address,
          message,
        });

        // Step 2: Send signature to backend relayer
        setStep("relaying");
        const result: RelayClaimResponse = await api.relayClaim(
          dropId,
          address,
          signature as string,
          timestamp
        );

        // Step 3: Record the claim on the backend
        setStep("recording");
        await api.recordClaim(dropId, result.txHash, address, "external");

        setIsLoading(false);
        setStep("complete");

        return { txHash: result.txHash };
      } catch (err: unknown) {
        console.error("[claimDrop] Error:", err instanceof Error ? err.message : "Unknown error");
        setError(err instanceof Error ? err.message : "Failed to claim drop");
        setIsLoading(false);
        setStep("idle");
        throw err;
      }
    },
    [address, signMessageAsync]
  );

  return {
    claimDrop,
    isLoading,
    error,
    step,
  };
}

// ========================================
// CLAIM DROP HOOK (Privy Wallets) - Gasless
// ========================================
export function useClaimDropPrivy() {
  const { user, signMessage } = usePrivy();
  const { wallets } = useWallets();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<
    "idle" | "signing" | "relaying" | "recording" | "complete"
  >("idle");

  const claimDrop = useCallback(
    async (dropId: string, onchainId: string, isPublic: boolean = false) => {
      if (!signMessage) {
        throw new Error("signMessage not available");
      }

      // Force use of Privy embedded wallet (walletClientType === "privy")
      // user.wallet.address might point to external wallet, so we explicitly find Privy wallet
      const privyWallet = wallets.find((w) => w.walletClientType === "privy");

      if (!privyWallet?.address) {
        throw new Error("Privy embedded wallet not found");
      }

      // Use Privy embedded wallet address - this is the address that should sign and claim
      const privyAddress = privyWallet.address as `0x${string}`;

      setIsLoading(true);
      setError(null);
      setStep("signing");

      try {
        // Step 1: Sign authorization message (FREE - no gas, no transaction)
        const timestamp = Math.floor(Date.now() / 1000);
        const message = `GiftLink Claim Authorization
Drop ID: ${onchainId}
Claimer: ${privyAddress}
Timestamp: ${timestamp}`;

        const { signature } = await signMessage({ message });

        // Step 2: Send signature to backend relayer with Privy address
        setStep("relaying");
        const result: RelayClaimResponse = await api.relayClaim(
          dropId,
          privyAddress,
          signature,
          timestamp
        );

        // Step 3: Record the claim on the backend
        setStep("recording");
        await api.recordClaim(dropId, result.txHash, privyAddress, "privy");

        setIsLoading(false);
        setStep("complete");

        return { txHash: result.txHash };
      } catch (err: unknown) {
        console.error("[claimDropPrivy] Error:", err instanceof Error ? err.message : "Unknown error");
        setError(err instanceof Error ? err.message : "Failed to claim drop");
        setIsLoading(false);
        setStep("idle");
        throw err;
      }
    },
    [wallets, signMessage]
  );

  return {
    claimDrop,
    isLoading,
    error,
    step,
  };
}
