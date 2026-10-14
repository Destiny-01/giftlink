/**
 * Hook to fetch USDC balance for each individual wallet
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { usePublicClient } from "wagmi";
import { useAuth } from "./useAuth";
import { ERC20BalanceABI } from "@/lib/abi";
import { formatUnits } from "viem";
import { network } from "@/config/network";

const USDC_CONTRACT_ADDRESS = network.usdcAddress;

// USDC has 6 decimals
const USDC_DECIMALS = 6;

export interface WalletBalance {
  address: string;
  balance: string; // Formatted balance string
  balanceRaw: bigint; // Raw balance in wei
  walletType: "privy" | "external";
  isEnabled: boolean; // true if balance > 0
}

export function useWalletBalances() {
  const { wallets, isAuthenticated } = useAuth();
  const publicClient = usePublicClient();
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);

  // Get all wallets with their addresses
  const walletList = useMemo(() => {
    if (!isAuthenticated || !wallets) return [];
    return wallets
      .map((w) => ({
        address: w.address,
        walletType:
          w.walletClientType === "privy"
            ? ("privy" as const)
            : ("external" as const),
      }))
      .filter(
        (
          w
        ): w is { address: `0x${string}`; walletType: "privy" | "external" } =>
          !!w.address && w.address.startsWith("0x")
      );
  }, [wallets, isAuthenticated]);

  // Create a stable string key for wallet list to detect changes
  const walletListKey = useMemo(
    () =>
      walletList
        .map((w) => `${w.address}:${w.walletType}`)
        .sort()
        .join(","),
    [walletList]
  );

  // Fetch balances function - depends on walletListKey to trigger on wallet changes
  const fetchBalances = useCallback(async () => {
    // Access latest walletList from closure
    const currentWalletList = walletList;

    if (!isAuthenticated || currentWalletList.length === 0) {
      setBalances({});
      return;
    }

    setIsLoading(true);
    setIsError(false);

    try {
      if (!publicClient) {
        setIsLoading(false);
        return;
      }

      const balancePromises = currentWalletList.map(async ({ address }) => {
        try {
          // @ts-expect-error - Type definition mismatch with wagmi/viem versions
          const balance = (await publicClient.readContract({
            address: USDC_CONTRACT_ADDRESS,
            abi: ERC20BalanceABI,
            functionName: "balanceOf",
            args: [address],
          })) as bigint;
          return { address, balance };
        } catch (error) {
          console.error(
            "Failed to fetch wallet balance:",
            error instanceof Error ? error.message : "Unknown error"
          );
          return { address, balance: 0n };
        }
      });

      const results = await Promise.all(balancePromises);
      const balanceMap: Record<string, bigint> = {};
      results.forEach(({ address, balance }) => {
        balanceMap[address] = balance;
      });
      setBalances(balanceMap);
    } catch (error) {
      console.error("Failed to fetch balances:", error instanceof Error ? error.message : "Unknown error");
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, publicClient, walletList]);

  // Fetch balances on mount and when wallet list changes
  useEffect(() => {
    fetchBalances();
  }, [walletListKey, fetchBalances]);

  // Format wallet balances
  const walletBalances = useMemo<WalletBalance[]>(() => {
    return walletList.map((wallet) => {
      const balanceRaw = balances[wallet.address] || 0n;
      const balanceFloat = parseFloat(formatUnits(balanceRaw, USDC_DECIMALS));
      const balance = balanceFloat.toFixed(2);
      const isEnabled = balanceRaw > 0n;

      return {
        address: wallet.address,
        balance,
        balanceRaw,
        walletType: wallet.walletType,
        isEnabled,
      };
    });
  }, [walletList, balances]);

  return {
    wallets: walletBalances,
    isLoading,
    isError,
    refresh: fetchBalances,
  };
}
