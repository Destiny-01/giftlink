/**
 * Nomine Claim Core types - request/response and view types for the spec §8 endpoints and the
 * campaign / entitlement / status model. Canonical source: `docs/nomine-claim-core-integration.md`.
 */

// ---------------------------------------------------------------------------
// Enumerations (spec §6, §7)
// ---------------------------------------------------------------------------

export type CampaignStatus = "DRAFT" | "FUNDED" | "RECLAIMED";

export type ClaimRequestStatus =
  | "CONSENTED"
  | "ISSUER_APPROVED"
  | "SUBMITTED"
  | "SETTLED"
  | "FAILED"
  | "EXPIRED";

/** The three claimant-facing lifecycle groups. Everything else lives inside Available. */
export type LifecycleGroup = "AVAILABLE" | "COMPLETED" | "EXPIRED";

/** Fine-grained workflow states shown inside Available. */
export type WorkflowState =
  | "AWAITING_ISSUER"
  | "AWAITING_RESOLVER"
  | "PENDING_SUBMISSION";

export type GateAuthority = "issuerApprover" | "resolver";

/**
 * How a campaign approves a consent. `auto` settles server-side on consent; `manual` waits for the
 * issuer. Optional because the backend that serves it lands separately - the app must work before
 * and after.
 */
export type ApprovalMode = "auto" | "manual";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type Hex = `0x${string}`;

/** USDC amounts are base units (6 decimals) carried as strings end-to-end. */
export type BaseUnits = string;

// ---------------------------------------------------------------------------
// Campaign model
// ---------------------------------------------------------------------------

export interface CampaignAccounting {
  budget: BaseUnits;
  settled: BaseUnits;
  remainingUnsettled: BaseUnits;
  reclaimable: BaseUnits;
}

/** `NomineClaimCore.CampaignConfig` as returned by `POST /campaigns/prepare`. */
export interface CampaignConfigPayload {
  issuerApprover: Hex;
  resolver: Hex;
  allocation: BaseUnits;
  openingTime: number;
  expiryTime: number;
  entitlementIds: Hex[];
}

/** Issuer-only roster summary. Never includes raw emails. */
export interface RosterSummary {
  count: number;
  /** Masked, non-reversible display strings only (e.g. "j***@gmail.com"). */
  maskedEmails?: string[];
  entitlementRoot?: Hex;
}

export interface NomineCampaign {
  id: string;
  /** Optional human-readable label. Absent today; the UI falls back to a description. */
  name?: string | null;
  chainId: number;
  contractAddress: string;
  onchainId?: number | null;
  issuerAddress: string;
  issuerApproverAddress: string;
  resolverAddress: string;
  allocation: BaseUnits;
  entitlementCount: number;
  /** Entitlements consumed by a verified settlement. */
  consumedCount?: number | null;
  fundingTxHash?: string | null;
  paramsHash?: string | null;
  openingTime: number;
  expiryTime: number;
  status: CampaignStatus;
  /** `auto` pays on claim; `manual` needs the issuer to sign each payout. */
  approvalMode?: ApprovalMode | null;
  reclaimedTxHash?: string | null;
  createdAt?: string;
  accounting?: CampaignAccounting;
  roster?: RosterSummary;
}

/** Public link view (spec §8 `GET /campaigns/:id/public`). No roster. */
export interface CampaignPublicView {
  id: string;
  /** The campaign's on-chain id, when it has been funded. */
  onchainId?: number | null;
  issuer: string;
  /** Optional human-readable issuer label. */
  issuerName?: string | null;
  chainId: number;
  contractAddress: string;
  usdcAddress: string;
  allocation: BaseUnits;
  entitlementCount: number;
  openingTime: number;
  expiryTime: number;
  issuerApproverAddress: string;
  resolverAddress: string;
  status: CampaignStatus;
  funded: boolean;
  /** On-chain verifiable funding evidence. */
  fundingTxHash?: string | null;
  /** `auto` settles on consent; `manual` waits for the issuer. Absent on older backends. */
  approvalMode?: ApprovalMode | null;
  /** Fixed, non-negotiable recovery rule copy provided by the backend. */
  recoveryRule: string;
}

// ---------------------------------------------------------------------------
// Issuer endpoints (spec §8)
// ---------------------------------------------------------------------------

export interface PrepareCampaignRequest {
  allocation: BaseUnits;
  emails: string[];
  openingTime: number;
  expiryTime: number;
  /**
   * Omitted entirely to select automatic approval, which is the default. When present, every payout
   * needs an `Approval` signature from this distinct external address.
   */
  issuerApproverAddress?: string;
}

export interface PrepareCampaignResponse {
  campaignId: string;
  config: CampaignConfigPayload;
  entitlementCount: number;
  budget: BaseUnits;
  entitlementRoot: Hex;
  paramsHash: string;
  status: CampaignStatus;
  /**
   * The issuer's own recipient record, returned once at prepare time. Nomine keeps only the salted
   * hash, so the issuer must retain this to verify a wallet assignment independently later.
   */
  mapping: Array<{ entitlementId: Hex; email: string }>;
}

export interface ConfirmCampaignRequest {
  txHash: string;
}

export interface ConfirmCampaignResponse {
  campaignId: string;
  onchainId: string;
  status: CampaignStatus;
}

export interface ConfirmRecoveryResponse {
  campaignId: string;
  status: CampaignStatus;
  reclaimedTxHash: string;
}

export interface CampaignRequestsResponse {
  requests: IssuerApprovalRequest[];
}

/** A live consent the issuer is being asked to approve. */
export interface IssuerApprovalRequest {
  id: string;
  campaignId: string;
  entitlementId: Hex;
  walletAddress: string;
  amount: BaseUnits;
  deadline: number;
  status: ClaimRequestStatus;
  /** Present on the issuer's request list; the backend never exposes it after approval. */
  consentDigest?: Hex;
  requestedAt?: string;
  /** The backend exposes presence, never the issuer's signature itself. */
  hasIssuerApproval?: boolean;
  submitTxHash?: string | null;
  settlementTxHash?: string | null;
  /** Synthesized from a verified Settlement event only; null while unsettled. */
  receipt?: SettlementReceipt | null;
  consentSignature?: string | null;
  issuerApprovalSignature?: string | null;
}

export interface IssuerApprovalRequestResponse {
  request: IssuerApprovalRequest;
}

export interface SubmitIssuerApprovalRequest {
  signature: string;
}

export interface RecoverConfirmRequest {
  txHash: string;
}

// ---------------------------------------------------------------------------
// Claimant endpoints (spec §8)
// ---------------------------------------------------------------------------

export interface SubmitConsentRequest {
  entitlementId: Hex;
  walletAddress: string;
  amount: BaseUnits;
  deadline: number;
  signature: string;
}

export interface SubmitConsentResponse {
  request: ClaimRequestView;
}

/**
 * Why an automatic payout did not complete. Present only when an `auto` campaign approved the
 * consent but the settlement transaction failed, in which case the request stays `ISSUER_APPROVED`.
 */
export interface SettleError {
  code: string;
  message: string;
}

export interface ClaimRequestView {
  id: string;
  campaignId: string;
  entitlementId: Hex;
  walletAddress: string;
  amount: BaseUnits;
  deadline: number;
  status: ClaimRequestStatus;
  consentDigest?: Hex | null;
  consentSignature?: string | null;
  issuerApprovalSignature?: string | null;
  submitTxHash?: string | null;
  settlementTxHash?: string | null;
  failureReason?: string | null;
  settleError?: SettleError | null;
  createdAt?: string;
  updatedAt?: string;
  receipt?: SettlementReceipt | null;
}

export interface ClaimRequestDetailResponse {
  request: ClaimRequestView;
}

export interface SettleRequestResponse {
  request: ClaimRequestView;
}

/** Only ever rendered for a verified `Settlement` event. */
export interface SettlementReceipt {
  campaignId: string;
  entitlementId: Hex;
  wallet: string;
  amount: BaseUnits;
  txHash: string;
  blockNumber?: number | null;
  submitter?: string | null;
  settledAt?: string | null;
  /** Sponsor gas is tracked separately and never counted as campaign funding. */
  sponsored?: boolean;
}

// ---------------------------------------------------------------------------
// Inbox (spec §7, §8)
// ---------------------------------------------------------------------------

export interface NomineEntitlement {
  entitlementId: Hex;
  campaignId: string;
  campaign: CampaignPublicView;
  amount: BaseUnits;
  /** On-chain lifecycle group. */
  status: LifecycleGroup;
  /** Workflow state when inside Available. */
  workflowState?: WorkflowState | null;
  /** Consumed only by a verified Settlement. */
  consumedAt?: string | null;
  settlementTxHash?: string | null;
  claimantAddress?: string | null;
  request?: ClaimRequestView | null;
  /** Unix seconds; `openingTime` of the parent campaign. */
  opensAt?: number | null;
  /** Whether the entitlement is currently claimable (funded + open + unconsumed). */
  claimable?: boolean;
}

export interface InboxResponse {
  entitlements: NomineEntitlement[];
}

// ---------------------------------------------------------------------------
// UI helper shapes
// ---------------------------------------------------------------------------

export type SigningWalletType = "privy" | "external";

export interface SigningWallet {
  address: Hex;
  walletType: SigningWalletType;
}

export interface CampaignGrouping {
  available: NomineEntitlement[];
  completed: NomineEntitlement[];
  expired: NomineEntitlement[];
  /** Funded but before openingTime - shown inside Available with an "Opens" label. */
  preOpening: NomineEntitlement[];
}
