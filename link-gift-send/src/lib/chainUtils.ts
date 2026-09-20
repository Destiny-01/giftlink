/**
 * Utility functions for handling Arc Network chain switching
 * Only called right before transactions (create/claim)
 */

import { toast } from "@/hooks/use-toast";
import { defineChain } from "viem";

const ARC_CHAIN_ID = parseInt(import.meta.env.VITE_ARC_CHAIN_ID || "1243", 10);

// Arc Network chain definition (same as in main.tsx)
export const arcChain = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet Network",
  nativeCurrency: {
    decimals: 18,
    name: "USDC",
    symbol: "USDC",
  },
  rpcUrls: {
    default: {
      http: [
        import.meta.env.VITE_ARC_RPC_URL || "https://rpc.testnet.arc.network",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: "https://testnet.arcscan.app",
    },
  },
});

/**
 * Wait for chain to switch by polling the current chainId
 */
function waitForChainSwitch(
  getCurrentChainId: () => number | undefined,
  targetChainId: number,
  timeout: number = 30000
): Promise<boolean> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      const currentChainId = getCurrentChainId();

      if (currentChainId === targetChainId) {
        clearInterval(checkInterval);
        resolve(true);
        return;
      }

      // Timeout after 30 seconds
      if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        resolve(false);
        return;
      }
    }, 500); // Check every 500ms
  });
}

/**
 * Ensure user is on Arc Network before transaction
 * For external wallets only - checks if chain is added, adds if needed, then switches
 * WAITS for switch to complete before returning
 * Returns true if successfully on Arc Network, false otherwise
 */
export async function ensureArcNetwork(
  switchChain: () => void,
  getCurrentChainId: () => number | undefined,
  isExternalWallet?: boolean
): Promise<boolean> {
  // Skip for Privy embedded wallets
  if (!isExternalWallet) {
    return true; // Don't block Privy wallets
  }

  const currentChainId = getCurrentChainId();

  // Already on Arc Network
  if (currentChainId === ARC_CHAIN_ID) {
    return true;
  }

  if (!switchChain) {
    toast({
      title: "Chain switch not available",
      description: "Please manually switch to Arc Network in your wallet",
      variant: "destructive",
    });
    return false;
  }

  // Check if window.ethereum exists (for adding chain)
  interface EthereumProvider {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  }
  const ethereum = (window as Window & { ethereum?: EthereumProvider })
    .ethereum;
  if (!ethereum) {
    toast({
      title: "Wallet not found",
      description: "Please connect your wallet first",
      variant: "destructive",
    });
    return false;
  }

  try {
    // First, try to add the chain (this is safe even if already added)
    const chainParams = {
      chainId: `0x${ARC_CHAIN_ID.toString(16)}`,
      chainName: "Arc Testnet Network",
      nativeCurrency: {
        name: "USDC",
        symbol: "USDC",
        decimals: 18,
      },
      rpcUrls: [
        import.meta.env.VITE_ARC_RPC_URL || "https://rpc.testnet.arc.network",
      ],
      blockExplorerUrls: ["https://testnet.arcscan.app"],
    };

    // Try adding the chain first (if not already added)
    try {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [chainParams],
      });

      // Chain added (or was already added), wait a moment for it to be registered
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (addError: unknown) {
      const addErrorMessage =
        addError instanceof Error ? addError.message : String(addError);

      // If error is that chain already exists, that's fine - continue to switch
      if (
        !addErrorMessage.includes("already exists") &&
        !addErrorMessage.includes("already added") &&
        !addErrorMessage.includes("User rejected")
      ) {
        // Continue anyway - chain might already be added
      }

      // If user rejected adding chain, abort
      if (
        addErrorMessage.includes("User rejected") ||
        addErrorMessage.includes("rejected")
      ) {
        toast({
          title: "Network addition cancelled",
          description: `Please manually add Arc Network (Chain ID ${ARC_CHAIN_ID}) in your wallet`,
          variant: "default",
        });
        return false;
      }
    }

    // Now try switching to the chain
    toast({
      title: "Switching to Arc Network",
      description: "Please approve the network switch in your wallet",
      variant: "default",
    });

    // Trigger the chain switch
    switchChain();

    // Wait for the chain to actually switch by polling
    const switched = await waitForChainSwitch(
      getCurrentChainId,
      ARC_CHAIN_ID,
      30000 // 30 second timeout
    );

    if (!switched) {
      toast({
        title: "Network switch timeout",
        description: `Please manually switch to Arc Network (Chain ID ${ARC_CHAIN_ID}) in your wallet`,
        variant: "destructive",
      });
      return false;
    }

    // Successfully switched!
    toast({
      title: "Network switched",
      description: "Successfully switched to Arc Network",
      variant: "default",
    });

    return true;
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Failed to switch network";

    // If user rejected, don't show error
    if (
      errorMessage.includes("User rejected") ||
      errorMessage.includes("rejected")
    ) {
      return false;
    }

    toast({
      title: "Failed to switch network",
      description:
        errorMessage ||
        `Please manually switch to Arc Network (Chain ID ${ARC_CHAIN_ID}) in MetaMask`,
      variant: "destructive",
    });
    return false;
  }
}
