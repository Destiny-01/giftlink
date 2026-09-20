/**
 * API service layer - Backend-aware API helpers
 */

import type {
  Gift,
  CreateDropPayload,
  CreateDropResponse,
  ClaimDropResponse,
  DropSummary,
  PaginatedResponse,
  PrepareDropResponse,
  RelayClaimResponse,
  StatsResponse,
  UserDropsResponse,
} from "@/types/gift";
import { ApiError, normalizeError, parseErrorResponse } from "@/lib/utils";

const API_BASE_URL = import.meta.env.VITE_API_URL || "https://api.giftlink.arc";

// Global identity token getter - will be set by IdentityTokenProvider
let getIdentityToken: (() => string | null) | null = null;

/**
 * Set the identity token getter function
 * Called by IdentityTokenProvider to provide the token
 */
export function setIdentityTokenGetter(getter: () => string | null) {
  getIdentityToken = getter;
}

/**
 * Get auth token from localStorage (fallback for backward compatibility)
 */
function getAuthToken(): string | null {
  const token =
    localStorage.getItem("privy:token") ||
    localStorage.getItem("auth_token") ||
    null;
  if (!token) return null;

  // Remove quotes if token is wrapped in them (JSON string)
  try {
    const parsed = JSON.parse(token);
    return typeof parsed === "string" ? parsed : token;
  } catch {
    // If not JSON, check if it starts/ends with quotes and strip them
    if (token.startsWith('"') && token.endsWith('"')) {
      return token.slice(1, -1);
    }
    return token;
  }
}

/**
 * Make authenticated fetch request
 * Uses Privy identity token in Authorization header (instead of cookies)
 */
async function fetchWithAuth(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  const identityToken = getIdentityToken?.() || getAuthToken();
  console.log(identityToken, "identityToken");
  if (identityToken) {
    headers.Authorization = `Bearer ${identityToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return response;
}

/**
 * Authenticate user with backend using Privy token
 */
export async function authenticateUser(
  authToken: string,
  walletAddress?: string
): Promise<{ token: string; user: { address?: string } }> {
  try {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    // Include identity token in Authorization header if available
    const identityToken = getIdentityToken?.() || null;
    if (identityToken) {
      headers.Authorization = `Bearer ${identityToken}`;
    }

    const response = await fetch(`${API_BASE_URL}/api/users/authenticate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        authToken,
        walletAddress: walletAddress || null,
      }),
      credentials: "include",
    });

    if (!response.ok) {
      throw await parseErrorResponse(response);
    }

    const data = await response.json();

    // Store auth token
    if (data.token) {
      localStorage.setItem("auth_token", data.token);
    }

    return data;
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Logout user
 */
export async function logoutUser(): Promise<void> {
  try {
    await fetchWithAuth("/api/users/logout", { method: "POST" });
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user_id");
  } catch (error) {
    // Clear token even if request fails
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user_id");
    throw normalizeError(error);
  }
}

/**
 * Prepare a drop (get permit and tx data)
 */
export async function prepareDrop(
  payload: CreateDropPayload & { senderAddress?: string; walletType?: string }
): Promise<PrepareDropResponse> {
  try {
    const response = await fetchWithAuth("/api/drops/prepare", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return await response.json();
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Confirm drop creation (after chain tx)
 * Supports both old format (txHash only) and new format (dropId, onchainId, txHash)
 */
export async function confirmDrop(
  dropId: string,
  txHashOrOnchainId: string | number,
  txHash?: string
): Promise<CreateDropResponse> {
  try {
    // New format: dropId, onchainId (number), txHash
    if (txHash && typeof txHashOrOnchainId === "number") {
      const response = await fetchWithAuth(`/api/drops/confirm`, {
        method: "POST",
        body: JSON.stringify({ dropId, onchainId: txHashOrOnchainId, txHash }),
      });
      const data = await response.json();
      return {
        id: data.id || dropId,
        txHash: data.txHash || txHash,
        claimLink:
          data.claimLink ||
          `${window.location.origin}/claim/${data.id || dropId}`,
      };
    }
    // Old format: dropId, txHash
    const response = await fetchWithAuth(`/api/drops/confirm`, {
      method: "POST",
      body: JSON.stringify({ txHash: txHashOrOnchainId }),
    });
    const data = await response.json();
    return {
      id: data.id || dropId,
      txHash: data.txHash || txHashOrOnchainId,
      claimLink:
        data.claimLink ||
        `${window.location.origin}/claim/${data.id || dropId}`,
    };
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Create a new gift drop (legacy - use prepareDrop + confirmDrop for chained flow)
 */
export async function createDrop(
  payload: CreateDropPayload
): Promise<CreateDropResponse> {
  try {
    const response = await fetchWithAuth("/api/drops", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return await response.json();
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Get permit for claiming a drop
 * Supports both old format (GET) and new format (POST with claimerAddress, claimerIdentifier, walletType)
 */
export async function getClaimPermit(
  id: string,
  claimerAddress?: string,
  claimerIdentifier?: string,
  walletType?: string
): Promise<{
  permit: {
    dropId?: number;
    claimer?: string;
    expiry?: number;
    permitExpiry?: number;
    owner?: string;
    spender?: string;
    value?: string;
    nonce?: number;
    deadline?: number;
  };
  signature: string;
}> {
  try {
    // New format: POST with body
    if (claimerAddress) {
      const response = await fetchWithAuth(`/api/drops/${id}/claim-permit`, {
        method: "POST",
        body: JSON.stringify({ claimerAddress, claimerIdentifier, walletType }),
      });
      return await response.json();
    }
    // Old format: GET
    const response = await fetchWithAuth(`/api/drops/${id}/permit`, {
      method: "GET",
    });
    return await response.json();
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Record claim transaction (after chain tx)
 * Supports both old format and new format (with walletType)
 */
export async function recordClaim(
  id: string,
  txHash: string,
  claimantWalletAddress: string,
  walletType?: string
): Promise<ClaimDropResponse> {
  try {
    // New format: use /claimed endpoint
    if (walletType) {
      const response = await fetchWithAuth(`/api/drops/${id}/claimed`, {
        method: "POST",
        body: JSON.stringify({
          txHash,
          claimerAddress: claimantWalletAddress,
          walletType,
        }),
      });
      return await response.json();
    }
    // Old format: use /claim endpoint
    const response = await fetchWithAuth(`/api/drops/${id}/claim`, {
      method: "POST",
      body: JSON.stringify({
        txHash,
        claimantWalletAddress,
      }),
    });
    return await response.json();
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Confirm claim (new format - alias for recordClaim with walletType)
 */
export async function confirmClaim(
  dropId: string,
  txHash: string,
  claimerAddress: string,
  walletType: string
): Promise<ClaimDropResponse> {
  return recordClaim(dropId, txHash, claimerAddress, walletType);
}

/**
 * Relay claim - gasless claiming where backend submits transaction
 * User signs an authorization message (free, no gas)
 */
export async function relayClaim(
  dropId: string,
  claimer: string,
  claimerSignature: string,
  timestamp: number
): Promise<RelayClaimResponse> {
  try {
    const response = await fetchWithAuth(`/api/drops/${dropId}/relay-claim`, {
      method: "POST",
      body: JSON.stringify({ claimer, claimerSignature, timestamp }),
    });
    return await response.json();
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Claim a gift drop (legacy - use getClaimPermit + recordClaim for chained flow)
 */
export async function claimDrop(
  id: string,
  claimantWalletAddress: string
): Promise<ClaimDropResponse> {
  try {
    const response = await fetchWithAuth(`/api/drops/${id}/claim`, {
      method: "POST",
      body: JSON.stringify({ claimantWalletAddress }),
    });
    return await response.json();
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Revoke a gift drop (records the transaction hash after contract call)
 */
export async function revokeDrop(
  id: string,
  txHash: string
): Promise<{ txHash: string }> {
  try {
    const response = await fetchWithAuth(`/api/drops/${id}/revoke`, {
      body: JSON.stringify({ txHash }),
      method: "POST",
    });
    return await response.json();
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Edit receiver of a targeted gift
 */
export async function editReceiver(
  id: string,
  newRecipientIdentifier: string,
  newRecipientType: string
): Promise<boolean> {
  try {
    const response = await fetchWithAuth(`/api/drops/${id}/update-receiver`, {
      method: "POST",
      body: JSON.stringify({
        newRecipientIdentifier,
        newRecipientType,
      }),
    });
    return response.ok;
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Get all drops for a user (sender, receiver, and claimable)
 */
export async function getUserDrops(
  ownerAddress: string,
  options?: { page?: number; limit?: number }
): Promise<UserDropsResponse> {
  try {
    const params = new URLSearchParams();
    if (options?.page) params.set("page", options.page.toString());
    if (options?.limit) params.set("limit", options.limit.toString());

    const response = await fetchWithAuth(
      `/api/users/${ownerAddress}/drops${params.toString() ? `?${params}` : ""}`
    );
    const data: UserDropsResponse = await response.json();

    return data;
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Get a specific drop by ID
 */
export async function getDropById(id: string): Promise<Gift> {
  try {
    const response = await fetchWithAuth(`/api/drops/${id}`);
    const data: DropSummary = await response.json();
    return dropToGift(data);
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Get user stats
 */
export async function getUserStats(address: string): Promise<StatsResponse> {
  try {
    const response = await fetchWithAuth(`/api/stats/user/${address}`);
    return await response.json();
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Convert DropSummary to Gift (for backward compatibility)
 */
export function dropToGift(drop: DropSummary): Gift {
  // Extract sender address from sender object or use string directly
  const senderAddress =
    typeof drop.sender === "string" ? drop.sender : drop.sender.address;

  // Extract claim transaction hash
  const claimTxHash = drop.transactions?.claim || drop.claimTxHash || undefined;

  // Extract revoke transaction hash
  const revokeTxHash =
    drop.transactions?.revoke || drop.revokeTxHash || undefined;

  // Determine if claimed based on claimer or transactions
  const claimed = drop.claimer !== null && drop.claimer !== undefined;

  // Extract claimedBy from claimer or legacy field
  const claimedBy = drop.claimer || drop.claimedBy;

  // Parse amount - if it contains a space, extract just the numeric part
  // Backend sometimes returns "0.000001 USDC" or just "1"
  let amount = drop.amount;
  if (typeof amount === "string" && amount.includes(" ")) {
    const parts = amount.split(" ");
    amount = parts[0]; // Take the numeric part
  }

  // Extract token symbol from token field or use tokenSymbol if available
  // Backend returns token as "USDC" string
  const tokenSymbol =
    drop.tokenSymbol ||
    (typeof drop.token === "string" && drop.token !== "" ? drop.token : "USDC");

  // Convert onchainId from number to string if present
  const onchainId =
    drop.onchainId !== null && drop.onchainId !== undefined
      ? String(drop.onchainId)
      : undefined;

  return {
    id: drop.id,
    onchainId,
    sender: senderAddress,
    senderName: drop.senderName,
    senderAvatar: drop.senderAvatar,
    recipientHash: undefined, // Not in summary
    recipientType: drop.recipientType,
    recipientIdentifier: drop.recipientIdentifier || drop.recipientDisplay,
    amount,
    token: drop.token,
    tokenSymbol,
    message: drop.message || undefined,
    createdAt: drop.createdAt || undefined, // Backend doesn't provide this field
    expiryAt: drop.expiresAt || undefined,
    status: drop.status,
    claimed: drop.claimed !== undefined ? drop.claimed : claimed,
    claimedBy: claimedBy || undefined,
    claimedByName: drop.claimedByName,
    claimTxHash,
    revokeTxHash,
    canClaim: drop.canClaim,
  };
}
