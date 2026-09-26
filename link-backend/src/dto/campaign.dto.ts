import { z } from "zod";

/**
 * Request/response shapes for the Nomine Claim Core surface
 * (`docs/nomine-claim-core-integration.md` §8).
 *
 * Validation is deliberately strict and never echoes a rejected value: the validator
 * summariser already strips anything the caller sent, and the schemas here add only the
 * fields the endpoints accept.
 */

const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
const txHashRegex = /^0x[A-Fa-f0-9]{64}$/;
const bytes32Regex = /^0x[0-9a-fA-F]{64}$/;
const uintStringRegex = /^\d+$/;

export const prepareCampaignSchema = z
  .object({
    /** Allocation per entitlement in USDC base units, as a decimal string. */
    allocation: z
      .string()
      .regex(uintStringRegex, "Allocation must be an integer string of USDC base units"),
    emails: z
      .array(z.string().trim().min(3, "Recipient email is too short").max(320))
      .min(1, "At least one recipient email is required")
      .max(10_000, "Too many recipients for one campaign"),
    openingTime: z.number().int().nonnegative(),
    expiryTime: z.number().int().positive(),
    issuerApproverAddress: z
      .string()
      .regex(ethAddressRegex, "Invalid issuer approver address"),
  })
  .superRefine((data, ctx) => {
    if (!/^[1-9]\d*$/.test(data.allocation)) {
      ctx.addIssue({
        path: ["allocation"],
        code: z.ZodIssueCode.custom,
        message: "Allocation must be greater than zero",
      });
    }
    if (data.expiryTime <= data.openingTime) {
      ctx.addIssue({
        path: ["expiryTime"],
        code: z.ZodIssueCode.custom,
        message: "expiryTime must be after openingTime",
      });
    }
  });

export type PrepareCampaignRequest = z.infer<typeof prepareCampaignSchema>;

export const confirmCampaignSchema = z.object({
  txHash: z.string().regex(txHashRegex, "Invalid transaction hash"),
});
export type ConfirmCampaignRequest = z.infer<typeof confirmCampaignSchema>;

export const reclaimConfirmSchema = z.object({
  txHash: z.string().regex(txHashRegex, "Invalid transaction hash"),
});
export type ReclaimConfirmRequest = z.infer<typeof reclaimConfirmSchema>;

export const consentSchema = z.object({
  entitlementId: z.string().regex(bytes32Regex, "Invalid entitlement identifier"),
  walletAddress: z.string().regex(ethAddressRegex, "Invalid payout wallet address"),
  amount: z
    .string()
    .regex(uintStringRegex, "Amount must be an integer string of USDC base units"),
  deadline: z.number().int().positive("Deadline must be a unix timestamp in seconds"),
  signature: z.string().min(1, "Consent signature is required"),
});
export type ConsentRequest = z.infer<typeof consentSchema>;

export const issuerApprovalSchema = z.object({
  signature: z.string().min(1, "Issuer approval signature is required"),
});
export type IssuerApprovalRequest = z.infer<typeof issuerApprovalSchema>;

export const campaignIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const campaignRequestParamSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
});

/** The exact `CampaignConfig` payload the funding wallet must submit (contract field order). */
export interface CampaignConfigPayloadResponse {
  issuerApprover: string;
  resolver: string;
  allocation: string;
  openingTime: number;
  expiryTime: number;
  entitlementIds: string[];
}

export interface PrepareCampaignResponse {
  campaignId: string;
  config: CampaignConfigPayloadResponse;
  entitlementCount: number;
  budget: string;
  entitlementRoot: string;
  paramsHash: string;
  status: string;
}

export interface CampaignAccountingResponse {
  budget: string;
  settled: string;
  remaining: string;
  reclaimable: string;
  settlementCount: number;
  reclaimed: boolean;
  source: "chain" | "local";
}

export interface CampaignSummaryResponse {
  id: string;
  chainId: number;
  contractAddress: string;
  onchainId: string | null;
  status: string;
  allocation: string;
  entitlementCount: number;
  consumedCount: number;
  openingTime: string;
  expiryTime: string;
  issuerAddress: string;
  issuerApproverAddress: string;
  resolverAddress: string;
  fundingTxHash: string | null;
  reclaimedTxHash: string | null;
  accounting: CampaignAccountingResponse;
  createdAt: string;
}

/** Public link view: no roster, no identities, only the facts a claim link needs. */
export interface CampaignPublicViewResponse {
  id: string;
  chainId: number;
  contractAddress: string;
  onchainId: string | null;
  issuerAddress: string;
  issuerApproverAddress: string;
  resolverAddress: string;
  allocation: string;
  entitlementCount: number;
  budget: string;
  status: string;
  fundingStatus: "awaiting_funding" | "funded" | "reclaimed";
  /** On-chain funding evidence for the public link: the canonical CampaignFunded tx. */
  fundingTxHash: string | null;
  openingTime: string;
  expiryTime: string;
  usdcAddress: string;
  usdcDecimals: number;
  recovery: string;
}

export interface ClaimRequestReceiptResponse {
  requestId: string;
  campaignId: string;
  entitlementId: string;
  walletAddress: string;
  amount: string;
  deadline: number;
  status: string;
  hasIssuerApproval: boolean;
  submitTxHash: string | null;
  settlementTxHash: string | null;
}

export interface InboxEntryResponse {
  entitlementId: string;
  status: "Available" | "Completed" | "Expired";
  workflowStatus: string;
  opensAt: string | null;
  settlementTxHash: string | null;
  campaign: CampaignPublicViewResponse;
  request: {
    requestId: string;
    status: string;
    walletAddress: string;
    amount: string;
    deadline: string;
  } | null;
}
