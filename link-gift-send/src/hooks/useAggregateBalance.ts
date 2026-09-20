/**
 * Hook to fetch and aggregate USDC balance from all connected wallets
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { usePublicClient } from "wagmi";
import { useAuth } from "./useAuth";
import { ERC20BalanceABI } from "@/lib/abi";
import { formatUnits } from "viem";

const USDC_CONTRACT_ADDRESS = (import.meta.env.VITE_USDC_CONTRACT_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

// USDC has 6 decimals
const USDC_DECIMALS = 6;

export function useAggregateBalance() {
  const { wallets, isAuthenticated } = useAuth();
  const publicClient = usePublicClient();
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);

  // Get all unique wallet addresses - memoized with string comparison
  const walletAddresses = useMemo(() => {
    if (!isAuthenticated || !wallets) return [];
    return wallets
      ?.map((w) => w.address)
      .filter((addr): addr is `0x${string}` => !!addr && addr.startsWith("0x"));
  }, [wallets, isAuthenticated]);

  // Create a stable string key for wallet addresses to detect changes
  const walletAddressesKey = useMemo(
    () => walletAddresses.sort().join(","),
    [walletAddresses]
  );

  // Fetch balances function - depends on walletAddressesKey to trigger on wallet changes
  const fetchBalances = useCallback(async () => {
    // Access latest walletAddresses from closure
    const currentWalletAddresses = walletAddresses;

    if (!isAuthenticated || currentWalletAddresses.length === 0) {
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

      const balancePromises = currentWalletAddresses.map(async (address) => {
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
          console.error(`Failed to fetch balance for ${address}:`, error);
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
      console.error("Failed to fetch balances:", error);
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, publicClient, walletAddresses]);

  // Fetch balances on mount and when wallet addresses change
  useEffect(() => {
    fetchBalances();
  }, [walletAddressesKey, fetchBalances]);

  // Aggregate all balances
  const aggregateBalance = useMemo(() => {
    if (Object.keys(balances).length === 0) return "0.00";

    const totalBalance = Object.values(balances).reduce((sum, balance) => {
      const balanceFloat = parseFloat(formatUnits(balance, USDC_DECIMALS));
      return sum + balanceFloat;
    }, 0);

    return totalBalance.toFixed(2);
  }, [balances]);

  return {
    balance: aggregateBalance,
    isLoading,
    isError,
    walletCount: walletAddresses.length,
    refresh: fetchBalances,
  };
}
