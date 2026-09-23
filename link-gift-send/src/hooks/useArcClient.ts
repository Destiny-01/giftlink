/**
 * Arc Network client hook
 * Orchestrates chained drop lifecycle: prepare → chain tx → confirm, claim permit → claim tx → record
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useSendTransaction,
  useWalletClient,
  usePublicClient,
  useAccount,
} from "wagmi";
import { useWallets } from "@privy-io/react-auth";
import type { Gift, CreateDropResponse, ClaimDropResponse } from "@/types/gift";
import * as api from "@/services/api";
import { normalizeError } from "@/lib/utils";
import { GiftLinkABI } from "@/lib/abi";

const GIFT_LINK_CONTRACT_ADDRESS = (import.meta.env
  .VITE_GIFTLINK_CONTRACT_ADDRESS || "0x") as `0x${string}`;

export interface DropFlowState {
  step: "idle" | "preparing" | "signing" | "confirming" | "complete";
  error: string | null;
  dropId?: string;
  txHash?: string;
}

export interface ClaimFlowState {
  step: "idle" | "getting-permit" | "signing" | "recording" | "complete";
  error: string | null;
  txHash?: string;
}

export function useArcClient() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropFlow, setDropFlow] = useState<DropFlowState>({
    step: "idle",
    error: null,
  });
  const [claimFlow, setClaimFlow] = useState<ClaimFlowState>({
    step: "idle",
    error: null,
  });

  // For raw transactions (createDrop)
  const {
    sendTransaction: sendRawTransaction,
    data: sendTxHash,
    isPending: isSendingTx,
    error: sendTxError,
  } = useSendTransaction();

  // For contract write transactions (claimDrop)
  const {
    writeContract,
    data: writeTxHash,
    isPending: isSigning,
    error: writeContractError,
  } = useWriteContract();

  // Wait for send transaction confirmation (createDrop)
  const {
    isLoading: isConfirmingSend,
    isSuccess: sendTxConfirmed,
    data: sendTxReceipt,
    error: sendTxReceiptError,
  } = useWaitForTransactionReceipt({
    hash: sendTxHash,
    query: {
      enabled: !!sendTxHash,
    },
  });

  // Wait for write contract transaction confirmation (claimDrop)
  const {
    isLoading: isConfirmingWrite,
    isSuccess: writeTxConfirmed,
    data: writeTxReceipt,
  } = useWaitForTransactionReceipt({
    hash: writeTxHash,
    query: {
      enabled: !!writeTxHash,
    },
  });

  // Track drop creation flow
  const createDropRef = useRef<{
    dropId?: string;
    onTxHash?: (hash: string) => void;
    resolve?: (result: CreateDropResponse | null) => void;
    reject?: (error: Error) => void;
  }>({});

  // Track claim flow
  const claimDropRef = useRef<{
    id?: string;
    walletAddress?: string;
    onTxHash?: (hash: string) => void;
    resolve?: (result: ClaimDropResponse | null) => void;
    reject?: (error: Error) => void;
  }>({});

  // Track revoke flow
  const revokeDropRef = useRef<{
    id?: string;
    resolve?: (success: boolean) => void;
    reject?: (error: Error) => void;
  }>({});

  // Handle send transaction hash (createDrop)
  useEffect(() => {
    if (sendTxHash && createDropRef.current.dropId) {
      setDropFlow((prev) => ({
        ...prev,
        step: "confirming",
        txHash: sendTxHash,
      }));
      createDropRef.current.onTxHash?.(sendTxHash);
    }
  }, [sendTxHash]);

  // Handle send transaction confirmation (createDrop)
  useEffect(() => {
    if (
      sendTxConfirmed &&
      sendTxReceipt &&
      createDropRef.current.dropId &&
      sendTxHash
    ) {
      (async () => {
        try {
          const dropId = createDropRef.current.dropId!;
          const confirmResult = await api.confirmDrop(dropId, sendTxHash);
          setDropFlow({
            step: "complete",
            error: null,
            dropId: confirmResult.id,
            txHash: confirmResult.txHash,
          });
          setIsLoading(false);
          if (createDropRef.current.resolve) {
            createDropRef.current.resolve(confirmResult);
          }
          createDropRef.current = {};
        } catch (err) {
          console.error("[useArcClient] Error confirming drop:", err instanceof Error ? err.message : "Unknown error");
          const apiError = normalizeError(err);
          setError(apiError.message);
          setDropFlow({ step: "idle", error: apiError.message });
          setIsLoading(false);
          if (createDropRef.current.reject) {
            createDropRef.current.reject(apiError);
          }
          createDropRef.current = {};
        }
      })();
    }
  }, [sendTxConfirmed, sendTxReceipt, sendTxHash]);

  // Handle send transaction errors
  useEffect(() => {
    if (sendTxError && createDropRef.current.reject) {
      console.error("[useArcClient] Send transaction failed");
      const error = normalizeError(sendTxError);
      setError(error.message);
      setDropFlow({ step: "idle", error: error.message });
      setIsLoading(false);
      createDropRef.current.reject(error);
      createDropRef.current = {};
    }
  }, [sendTxError]);

  // Handle send transaction receipt errors
  useEffect(() => {
    if (sendTxReceiptError && createDropRef.current.reject) {
      console.error("[useArcClient] Send transaction receipt failed");
      const error = normalizeError(sendTxReceiptError);
      setError(error.message);
      setDropFlow({ step: "idle", error: error.message });
      setIsLoading(false);
      createDropRef.current.reject(error);
      createDropRef.current = {};
    }
  }, [sendTxReceiptError]);

  // Handle write contract transaction hash (claimDrop or revokeDrop)
  useEffect(() => {
    if (writeTxHash && claimDropRef.current.id) {
      setClaimFlow((prev) => ({
        ...prev,
        step: "recording",
        txHash: writeTxHash,
      }));
      claimDropRef.current.onTxHash?.(writeTxHash);
    }
  }, [writeTxHash]);

  // Handle write contract transaction confirmation (claimDrop or revokeDrop)
  useEffect(() => {
    // Handle claim transaction confirmation
    if (
      writeTxConfirmed &&
      writeTxReceipt &&
      claimDropRef.current.id &&
      claimDropRef.current.walletAddress &&
      writeTxHash &&
      !revokeDropRef.current.id
    ) {
      (async () => {
        try {
          const id = claimDropRef.current.id!;
          const walletAddress = claimDropRef.current.walletAddress!;
          const recordResult = await api.recordClaim(
            id,
            writeTxHash,
            walletAddress
          );
          setClaimFlow({
            step: "complete",
            error: null,
            txHash: recordResult.txHash,
          });
          setIsLoading(false);
          if (claimDropRef.current.resolve) {
            claimDropRef.current.resolve(recordResult);
          }
          claimDropRef.current = {};
        } catch (err) {
          console.error("[useArcClient] Error recording claim:", err instanceof Error ? err.message : "Unknown error");
          const apiError = normalizeError(err);
          setError(apiError.message);
          setClaimFlow({ step: "idle", error: apiError.message });
          setIsLoading(false);
          if (claimDropRef.current.reject) {
            claimDropRef.current.reject(apiError);
          }
          claimDropRef.current = {};
        }
      })();
    }
    // Handle revoke transaction confirmation
    else if (
      writeTxConfirmed &&
      writeTxReceipt &&
      revokeDropRef.current.id &&
      writeTxHash &&
      !claimDropRef.current.id
    ) {
      (async () => {
        try {
          const id = revokeDropRef.current.id!;
          const recordResult = await api.revokeDrop(id, writeTxHash);
          setIsLoading(false);
          if (revokeDropRef.current.resolve) {
            revokeDropRef.current.resolve(true);
          }
          revokeDropRef.current = {};
        } catch (err) {
          console.error("[useArcClient] Error recording revoke:", err instanceof Error ? err.message : "Unknown error");
          const apiError = normalizeError(err);
          setError(apiError.message);
          setIsLoading(false);
          if (revokeDropRef.current.reject) {
            revokeDropRef.current.reject(apiError);
          }
          revokeDropRef.current = {};
        }
      })();
    }
  }, [writeTxConfirmed, writeTxReceipt, writeTxHash]);

  const revokeDrop = useCallback(
    async (id: string): Promise<boolean> => {
      setError(null);
      setIsLoading(true);

      return new Promise<boolean>((resolve, reject) => {
        (async () => {
          try {
            // Store ref for useEffect handlers
            revokeDropRef.current = {
              id,
              resolve,
              reject,
            };

            // Call revokeDrop on the contract
            const contractAddress = GIFT_LINK_CONTRACT_ADDRESS;

            // Call revokeDrop on our contract
            // @ts-expect-error - wagmi infers chain and account from context
            writeContract({
              address: contractAddress,
              abi: GiftLinkABI,
              functionName: "revokeDrop",
              args: [BigInt(id)],
            });

            // Transaction hash and confirmation will be handled by useEffect hooks
            // The promise will be resolved/rejected in the confirmation handler or error handlers
          } catch (err) {
            console.error("[useArcClient] Error in revokeDrop:", err instanceof Error ? err.message : "Unknown error");
            const apiError = normalizeError(err);
            setError(apiError.message);
            setIsLoading(false);
            reject(apiError);
            revokeDropRef.current = {};
          }
        })();
      });
    },
    [writeContract]
  );

  const editReceiver = useCallback(
    async (
      id: string,
      newRecipientIdentifier: string,
      newRecipientType: string
    ): Promise<boolean> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await api.editReceiver(
          id,
          newRecipientIdentifier,
          newRecipientType
        );
        return result;
      } catch (err) {
        console.error("[useArcClient] Editing receiver failed");
        const apiError = normalizeError(err);
        setError(apiError.message);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const getUserDrops = useCallback(
    async (
      address: string
    ): Promise<{
      sent: Gift[];
      received: Gift[];
      claimable: Gift[];
    }> => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await api.getUserDrops(address);

        // Convert DropSummary to Gift for each category
        return {
          sent: response.sent.drops.map(api.dropToGift),
          received: response.received.drops.map(api.dropToGift),
          claimable: response.claimable.drops.map(api.dropToGift),
        };
      } catch (err) {
        console.error("[useArcClient] Error getting user drops:", err instanceof Error ? err.message : "Unknown error");
        const apiError = normalizeError(err);
        setError(apiError.message);
        return {
          sent: [],
          received: [],
          claimable: [],
        };
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const getDropById = useCallback(async (id: string): Promise<Gift | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const gift = await api.getDropById(id);
      return gift;
    } catch (err) {
      console.error("[useArcClient] Error getting drop by id:", err instanceof Error ? err.message : "Unknown error");
      const apiError = normalizeError(err);
      setError(apiError.message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    // State
    isLoading:
      isLoading ||
      isSendingTx ||
      isSigning ||
      isConfirmingSend ||
      isConfirmingWrite,
    error,
    dropFlow,
    claimFlow,

    // Actions
    revokeDrop,
    editReceiver,
    getUserDrops,
    getDropById,
  };
}
