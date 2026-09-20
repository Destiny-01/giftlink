import { z } from "zod";

const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
const txHashRegex = /^0x([A-Fa-f0-9]{64})$/;

export const recipientTypeEnum = [
  "public",
  "email",
  "discord",
  "twitter",
  "wallet",
] as const;
export const walletTypeEnum = ["external", "privy"] as const;

const recipientIdentifierSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((val) => (val == null ? "" : val.trim()))
  .refine(
    (val) => val.length <= 255,
    "Recipient identifier too long (max 255 chars)"
  );

export const prepareDropSchema = z
  .object({
    recipientType: z.enum(recipientTypeEnum),
    recipientIdentifier: recipientIdentifierSchema,
    amount: z.string(),
    expiry: z
      .number({
        invalid_type_error: "Expiry must be a unix timestamp in seconds",
      })
      .int()
      .positive()
      .optional(),
    message: z.string().max(280, "Message too long (max 280 chars)").optional(),
    isAnonymous: z.boolean().optional().default(false),
    senderAddress: z.string().regex(ethAddressRegex, "Invalid sender address"),
    senderIdentifier: z.string().trim().max(255).optional(),
    walletType: z.enum(walletTypeEnum),
  })
  .superRefine((data, ctx) => {
    if (
      data.recipientType !== "public" &&
      data.recipientIdentifier.length === 0
    ) {
      ctx.addIssue({
        path: ["recipientIdentifier"],
        code: z.ZodIssueCode.custom,
        message: "Recipient identifier is required for targeted drops",
      });
    }
  });

export type PrepareDropRequest = z.infer<typeof prepareDropSchema>;

export interface PrepareDropResponse {
  dropId: string;
  recipientCommit: string;
  gasTankAmount: string;
  totalAmount: string;
  estimatedGasCost: string;
  contractParams: {
    recipientCommit: string;
    recipientType: number;
    expiry: number;
  };
  summary: {
    amount: string;
    token: string;
    recipientDisplay: string;
  };
}

export const confirmDropSchema = z.object({
  dropId: z.string().uuid(),
  onchainId: z.union([z.coerce.bigint(), z.number().int().nonnegative()]),
  txHash: z.string().regex(txHashRegex, "Invalid transaction hash"),
});

export type ConfirmDropRequest = z.infer<typeof confirmDropSchema>;

export const claimPermitSchema = z.object({
  claimerAddress: z.string().regex(ethAddressRegex, "Invalid claimer address"),
  claimerIdentifier: z.string().trim().max(255).optional(),
  walletType: z.enum(walletTypeEnum),
});

export type ClaimPermitRequest = z.infer<typeof claimPermitSchema>;

export const claimConfirmSchema = z.object({
  txHash: z.string().regex(txHashRegex, "Invalid transaction hash"),
  claimerAddress: z.string().regex(ethAddressRegex, "Invalid claimer address"),
  walletType: z.enum(walletTypeEnum),
});

export type ClaimConfirmRequest = z.infer<typeof claimConfirmSchema>;

export const updateReceiverSchema = z.object({
  newRecipientIdentifier: z
    .string()
    .trim()
    .min(1, "Recipient identifier is required")
    .max(255, "Recipient identifier too long"),
  newRecipientType: z.enum(recipientTypeEnum),
});

export type UpdateReceiverRequest = z.infer<typeof updateReceiverSchema>;

export const revokeDropSchema = z.object({
  txHash: z.string().regex(txHashRegex, "Invalid transaction hash"),
});

export type RevokeDropRequest = z.infer<typeof revokeDropSchema>;

export const userDropsQuerySchema = z.object({
  status: z
    .enum(["pending", "active", "claimed", "revoked", "expired"])
    .optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});

export const paginationQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});

export type UserDropsQuery = z.infer<typeof userDropsQuerySchema>;

export interface PaginationResponse {
  total: number;
  limit: number;
  offset: number;
}

export interface DropSummaryResponse {
  id: string;
  onchainId: string | null;
  status: string;
  amount: string;
  token: string;
  message?: string | null;
  expiresAt?: string | null;
  isAnonymous: boolean;
  sender: {
    address: string;
    identifier?: string | null;
  } | null;
  recipientType: string;
  recipientDisplay: string;
  canClaim: boolean;
  claimRequiresAuth: boolean;
  alreadyClaimed?: {
    address: string;
    claimedAt?: string | null;
  };
}

export interface ClaimPermitResponse {
  permit: {
    dropId: bigint | number;
    claimer: string;
    expiry: number;
  };
  signature: string;
  dropDetails: {
    amount: string;
    token: string;
  };
}

export const relayClaimSchema = z.object({
  claimer: z.string().regex(ethAddressRegex, "Invalid claimer address"),
  claimerSignature: z.string().min(1, "Claimer signature is required"),
  timestamp: z.number().int().positive("Timestamp must be a positive integer"),
});

export type RelayClaimRequest = z.infer<typeof relayClaimSchema>;

export interface RelayClaimResponse {
  txHash: string;
  amounts: {
    claimerReceived: string;
    relayerReimbursed: string;
  };
}
