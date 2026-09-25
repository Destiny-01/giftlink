/**
 * Authentication hook - integrates Privy OAuth + Wallet
 */

import { useEffect, useMemo, useRef, useCallback } from "react";
import {
  usePrivy,
  useWallets,
  getAccessToken,
  useConnectOrCreateWallet,
  useLoginWithEmail,
  useIdentityToken,
} from "@privy-io/react-auth";
import { useDisconnect } from "wagmi";
import * as api from "@/services/api";
import { useNavigate } from "react-router-dom";

export interface User {
  address?: string;
  email?: string;
  name?: string;
  avatar?: string;
  provider?: "wallet" | "email" | "x" | "discord";
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

/**
 * Custom hook for authentication state
 */
export function useAuth() {
  const {
    ready,
    authenticated,
    user: privyUser,
    login,
    logout: privyLogout,
    linkWallet,
    linkTwitter,
    linkDiscord,
    linkEmail,
  } = usePrivy();
  const { wallets: allWallets } = useWallets();
  const { disconnect } = useDisconnect();
  const { connectOrCreateWallet } = useConnectOrCreateWallet();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { identityToken } = useIdentityToken();
  const hasAuthenticatedRef = useRef(false);
  const lastAuthenticatedUserRef = useRef<string | undefined>(undefined);
  const navigate = useNavigate();

  // Set identity token getter for API service
  useEffect(() => {
    api.setIdentityTokenGetter(() => identityToken || null);
  }, [identityToken]);

  const wallets = useMemo(() => {
    if (!ready || !authenticated || !privyUser) {
      return [];
    }

    // Get all wallet addresses linked to this Privy user account
    const linkedWalletAddresses = new Set<string>();

    // Privy embedded wallet (always linked if user has one)
    if (privyUser.wallet?.address) {
      linkedWalletAddresses.add(privyUser.wallet.address.toLowerCase());
    }

    // Check linked accounts for wallet addresses
    // Privy stores linked wallets in linkedAccounts array (if available)
    if (privyUser.linkedAccounts && Array.isArray(privyUser.linkedAccounts)) {
      privyUser.linkedAccounts.forEach((account) => {
        if (
          account &&
          typeof account === "object" &&
          "type" in account &&
          "address" in account &&
          account.type === "wallet" &&
          typeof account.address === "string"
        ) {
          linkedWalletAddresses.add(account.address.toLowerCase());
        }
      });
    }

    // If no linked wallets found, return empty array to be safe
    // This ensures we don't show wallets from previous sessions
    if (linkedWalletAddresses.size === 0) {
      return [];
    }

    // Only return wallets that are actually linked to this user
    return allWallets.filter((wallet) => {
      if (!wallet.address) return false;
      return linkedWalletAddresses.has(wallet.address.toLowerCase());
    });
  }, [ready, authenticated, privyUser, allWallets]);
  // Sync linked accounts with backend
  const syncWithBackend = useCallback(async () => {
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) return;

      // Get primary wallet from filtered wallets (only wallets linked to current user)
      // This ensures we only sync wallets that belong to the current user
      const primaryWallet =
        wallets.find((w) => w.walletClientType === "privy")?.address ||
        wallets[0]?.address ||
        privyUser?.wallet?.address;

      // Authenticate with backend to sync linked accounts
      // Only sync the primary wallet - backend will handle linking other wallets when they're actually linked
      await api.authenticateUser(accessToken, primaryWallet || undefined);
    } catch (error) {
      console.error("Failed to sync with backend:", error instanceof Error ? error.message : "Unknown error");
      // Don't throw - this is a background sync
    }
  }, [wallets, privyUser]);

  // Sync with backend when authentication state changes
  useEffect(() => {
    if (ready && authenticated && privyUser) {
      // Only sync if this is a new authentication (not already synced)
      const currentUserId = privyUser.id;
      if (
        !hasAuthenticatedRef.current ||
        lastAuthenticatedUserRef.current !== currentUserId
      ) {
        hasAuthenticatedRef.current = true;
        lastAuthenticatedUserRef.current = currentUserId;

        // Small delay to ensure wallet connection is complete
        setTimeout(() => {
          syncWithBackend();
        }, 500);
      }
    } else if (!authenticated) {
      // Reset refs when logged out
      hasAuthenticatedRef.current = false;
      lastAuthenticatedUserRef.current = undefined;
    }
  }, [ready, authenticated, privyUser, wallets, syncWithBackend]);

  // Memoize wallet address to avoid unnecessary re-renders
  const walletAddress = useMemo(() => {
    if (!ready || !authenticated || !privyUser) return undefined;
    return (
      wallets.find((w) => w.walletClientType === "privy")?.address ||
      wallets[0]?.address ||
      privyUser.wallet?.address
    );
  }, [ready, authenticated, privyUser, wallets]);

  // Derive user object from Privy user
  const user: User | null = useMemo(() => {
    if (!ready || !authenticated || !privyUser) return null;

    const email = privyUser.email?.address;
    const twitter = privyUser.twitter;
    const discord = privyUser.discord;

    let provider: "wallet" | "x" | "discord" = "wallet";
    let name: string | undefined;
    let avatar: string | undefined;

    if (twitter) {
      provider = "x";
      name = twitter.username;
      avatar = twitter.profilePictureUrl;
    } else if (discord) {
      provider = "discord";
      name = discord.username;
      // Discord profile picture may not be available in Privy user object
      avatar = undefined;
    } else if (walletAddress) {
      provider = "wallet";
      name = walletAddress.slice(0, 6) + "..." + walletAddress.slice(-4);
    }

    return {
      address: walletAddress,
      email,
      name,
      avatar,
      provider,
    };
  }, [ready, authenticated, privyUser, walletAddress]);

  const connectWallet = async () => {
    try {
      // For existing users, connectOrCreateWallet connects but doesn't authenticate
      // We need to use login() which properly authenticates existing users
      // and allows them to connect their wallet
      if (authenticated) {
        // User is already authenticated, just link a new wallet if needed
        await linkWallet();
      } else {
        // User is not authenticated - use login() which will:
        // 1. Authenticate the user (if they have an account)
        // 2. Allow them to connect/link their wallet
        // This works for both new and existing users
        await login();
      }
    } catch (error) {
      console.error("Failed to connect wallet:", error instanceof Error ? error.message : "Unknown error");
      throw error;
    }
  };

  const signInWithEmail = async () => {
    try {
      // Sign in with email only - opens Privy's email login flow
      await login();
      // Note: Privy's login() will show all methods, but we can guide users to email
      // For true email-only, we'd need to implement useLoginWithEmail with custom UI
    } catch (error) {
      console.error("Failed to sign in with email:", error instanceof Error ? error.message : "Unknown error");
      throw error;
    }
  };

  const signInWithOAuth = async (provider: "x" | "discord") => {
    try {
      // Sign in with specific OAuth provider - opens Privy's login modal
      await login();
      // Note: Privy's login() shows all methods, but users can select their preferred OAuth
    } catch (error) {
      console.error(`Failed to sign in with ${provider}:`, error instanceof Error ? error.message : "Unknown error");
      throw error;
    }
  };

  const logout = async () => {
    try {
      // Disconnect all Wagmi wallet connections before logging out
      // This ensures wallet state is cleared and doesn't persist to the next session
      try {
        disconnect();
      } catch (disconnectError) {
        // Ignore disconnect errors - it's okay if there's nothing to disconnect
        console.log("No wallet to disconnect:", disconnectError instanceof Error ? disconnectError.message : "Unknown disconnectError");
      }

      // Logout from Privy
      await privyLogout();

      // Navigate to home
      navigate("/");
    } catch (error) {
      console.error("Failed to logout:", error instanceof Error ? error.message : "Unknown error");
    }
  };

  const linkAccount = async (
    type: "wallet" | "oauth",
    provider?: "x" | "discord" | "email"
  ) => {
    try {
      if (type === "wallet") {
        // Link external wallet
        await linkWallet();
        // Sync with backend after linking
        await syncWithBackend();
      } else if (provider) {
        // Link OAuth account
        switch (provider) {
          case "x":
            await linkTwitter();
            break;
          case "discord":
            await linkDiscord();
            break;
          case "email":
            await linkEmail();
            break;
          default:
            throw new Error(`Unsupported OAuth provider: ${provider}`);
        }
        // Sync with backend after linking
        await syncWithBackend();
      }
    } catch (error) {
      console.error("Failed to link account:", error instanceof Error ? error.message : "Unknown error");
      throw error;
    }
  };

  return {
    user,
    privyUser, // Expose Privy user object so Settings can check linked accounts
    wallets, // Expose all wallets so Settings can show all linked wallets
    isAuthenticated: ready && authenticated,
    isLoading: !ready,
    connectWallet,
    signInWithEmail,
    signInWithOAuth,
    logout,
    linkAccount,
    syncWithBackend,
    // Expose email login methods for custom implementation if needed
    sendEmailCode: sendCode,
    loginWithEmailCode: loginWithCode,
  };
}
