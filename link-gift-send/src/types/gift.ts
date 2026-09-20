/**
 * Gift/Drop type definitions for GiftLink
 */

export type RecipientType = "email" | "discord" | "twitter" | "ens" | "public";

export type GiftStatus =
  | "pending"
  | "active"
  | "claimed"
  | "expired"
  | "revoked";

export interface Gift {
  id: string;
  onchainId?: string;
  sender: string;
  senderName?: string; // Display name or ENS
  senderAvatar?: string;
  recipientHash?: string; // keccak(email) or 'public'
  recipientType?: RecipientType;
  recipientIdentifier?: string; // Masked for privacy (e.g., "j***@gmail.com")
  amount: string; // in USDC (decimal)
  token: string; // USDC contract address
  tokenSymbol?: string; // "USDC"
  message?: string;
  createdAt?: string;
  expiryAt?: string;
  status: GiftStatus;
  claimed: boolean;
  claimedBy?: string;
  claimedByName?: string;
  claimTxHash?: string;
  revokeTxHash?: string;
  canClaim?: boolean; // Whether the current user can claim this gift (from backend)
}

export type WalletType = "privy" | "external";

export interface CreateDropPayload {
  recipientType?: RecipientType;
  recipientIdentifier?: string;
  amount: string;
  message?: string;
  expiryDays?: number;
  fundingSource: string; // wallet address
  isPrivate?: boolean; // Private vs Public
  walletType?: WalletType;
}

export interface CreateDropResponse {
  id: string;
  txHash: string;
  claimLink: string;
}

export interface ClaimDropResponse {
  txHash: string;
  amount: string;
}

export interface RelayClaimResponse {
  txHash: string;
  amountToClaimer: string; // USDC amount claimer receives (in wei/smallest unit)
  amountToRelayer: string; // USDC amount relayer receives (in wei/smallest unit)
}

// Backend-aligned types
export interface DropSummary {
  id: string;
  status: GiftStatus;
  amount: string;
  token: string;
  message?: string | null;
  theme?: string | null;
  expiresAt?: string | null;
  isAnonymous: boolean;
  sender: {
    address: string;
    identifier?: string | null;
  };
  recipientType: RecipientType;
  recipientDisplay: string;
  canClaim: boolean;
  claimRequiresAuth: boolean;
  onchainId?: number | null;
  claimer?: string | null;
  links: {
    claim: string;
    view: string;
  };
  transactions: {
    creation?: string | null;
    claim?: string | null;
    revoke?: string | null;
  };
  // Legacy fields for backward compatibility
  senderName?: string;
  senderAvatar?: string;
  recipientIdentifier?: string;
  tokenSymbol?: string;
  createdAt?: string;
  claimed?: boolean;
  claimedBy?: string;
  claimedByName?: string;
  claimTxHash?: string;
  revokeTxHash?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface UserDropsResponse {
  sent: {
    drops: DropSummary[];
    pagination: {
      total: number;
      limit: number;
      offset: number;
    };
  };
  received: {
    drops: DropSummary[];
    pagination: {
      total: number;
      limit: number;
      offset: number;
    };
  };
  claimable: {
    drops: DropSummary[];
  };
}

export interface PermitResponse {
  permit: {
    owner: string;
    spender: string;
    value: string;
    nonce: number;
    deadline: number;
  };
  signature: string;
  deadline: number;
}

export interface PrepareDropResponse {
  dropId: string;
  recipientCommit: string; // 0x... hash
  gasTankAmount: string; // USDC amount for gas (in wei with 6 decimals, e.g., "0x5265c00" or decimal string "5400000" for 5.4 USDC)
  contractParams: {
    recipientCommit: string;
    recipientType: number; // 0-4
    expiry: number;
  };
  summary: {
    amount: string;
    token: string;
    recipientDisplay: string;
  };
  // Legacy fields (for backward compatibility)
  permit?: PermitResponse;
  txData?: {
    to: string;
    data: string;
    value: string;
  };
}

export interface StatsResponse {
  activeLinks: number;
  claimedToday: number;
  totalSent: string;
  totalReceived: string;
}
