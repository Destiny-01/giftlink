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
import type {
  CampaignConfigPayload,
  CampaignPublicView,
  CampaignRequestsResponse,
  CampaignStatus,
  ClaimRequestDetailResponse,
  ClaimRequestStatus,
  ClaimRequestView,
  ConfirmCampaignResponse,
  ConfirmRecoveryResponse,
  Hex,
  InboxResponse,
  IssuerApprovalRequest,
  IssuerApprovalRequestResponse,
  LifecycleGroup,
  NomineCampaign,
  NomineEntitlement,
  PrepareCampaignRequest,
  PrepareCampaignResponse,
  SettleRequestResponse,
  SettlementReceipt,
  SubmitConsentRequest,
  SubmitConsentResponse,
  WorkflowState,
} from "@/types/nomine";
import { ApiError, normalizeError, parseErrorResponse } from "@/lib/utils";
import { network } from "@/config/network";

const API_BASE_URL = network.apiUrl;

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

/* ==========================================================================
 * Nomine Claim Core - spec §8 endpoints
 * Canonical contract: docs/nomine-claim-core-integration.md. All routes are
 * under /api and carry the Privy bearer token via fetchWithAuth.
 *
 * The backend DTOs (`link-backend/src/dto/campaign.dto.ts`) are canonical. The
 * mapping helpers below are the single place where the wire shape becomes the
 * view types this app consumes, and `npm run typecheck` verifies both ends of
 * that mapping: a renamed or missing field is a compile error here rather than
 * an empty screen at runtime.
 * ========================================================================== */

/** Wire shapes exactly as the backend serializes them. */
interface RawCampaignAccounting {
  budget: string;
  settled: string;
  remaining: string;
  reclaimable: string;
}

interface RawCampaignSummary {
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
  accounting: RawCampaignAccounting;
  createdAt: string;
  roster?: { total: number };
}

interface RawCampaignPublicView {
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
  fundingTxHash: string | null;
  openingTime: string;
  expiryTime: string;
  usdcAddress: string;
  usdcDecimals: number;
  recovery: string;
}

interface RawRequestReceipt {
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

interface RawCampaignRequest {
  requestId: string;
  entitlementId: string;
  walletAddress: string;
  amount: string;
  deadline: number;
  status: string;
  consentDigest: string;
  hasIssuerApproval: boolean;
  submitTxHash: string | null;
  settlementTxHash: string | null;
  createdAt: string;
}

interface RawInboxEntry {
  entitlementId: string;
  status: string;
  workflowStatus: string;
  opensAt: string | null;
  settlementTxHash: string | null;
  campaign: RawCampaignPublicView;
  request: {
    requestId: string;
    status: string;
    walletAddress: string;
    amount: string;
    deadline: string;
  } | null;
}

interface RawPrepareResponse {
  campaignId: string;
  config: CampaignConfigPayload;
  entitlementCount: number;
  budget: string;
  entitlementRoot: string;
  paramsHash: string;
  status: string;
  mapping?: Array<{ entitlementId: string; email: string }>;
}

interface RawConfirmResponse {
  campaignId: string;
  onchainId: string;
  status: string;
}

interface RawRecoverResponse {
  campaignId: string;
  status: string;
  reclaimedTxHash: string;
}

/** ISO timestamps -> unix seconds, which is what every time comparison uses. */
function unixSecondsFromIso(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

/** The inbox carries unix seconds or an ISO string depending on the field. */
function unixSecondsFromEither(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : unixSecondsFromIso(trimmed);
}

function toNumberOrNull(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function campaignPublicViewFrom(raw: RawCampaignPublicView): CampaignPublicView {
  return {
    id: raw.id,
    onchainId: toNumberOrNull(raw.onchainId),
    issuer: raw.issuerAddress,
    chainId: raw.chainId,
    contractAddress: raw.contractAddress,
    usdcAddress: raw.usdcAddress,
    allocation: raw.allocation,
    entitlementCount: raw.entitlementCount,
    openingTime: unixSecondsFromIso(raw.openingTime),
    expiryTime: unixSecondsFromIso(raw.expiryTime),
    issuerApproverAddress: raw.issuerApproverAddress,
    resolverAddress: raw.resolverAddress,
    status: raw.status as CampaignStatus,
    funded: raw.fundingStatus !== "awaiting_funding",
    fundingTxHash: raw.fundingTxHash,
    recoveryRule: raw.recovery,
  };
}

function nomineCampaignFrom(raw: RawCampaignSummary): NomineCampaign {
  return {
    id: raw.id,
    chainId: raw.chainId,
    contractAddress: raw.contractAddress,
    onchainId: toNumberOrNull(raw.onchainId),
    issuerAddress: raw.issuerAddress,
    issuerApproverAddress: raw.issuerApproverAddress,
    resolverAddress: raw.resolverAddress,
    allocation: raw.allocation,
    entitlementCount: raw.entitlementCount,
    fundingTxHash: raw.fundingTxHash,
    openingTime: unixSecondsFromIso(raw.openingTime),
    expiryTime: unixSecondsFromIso(raw.expiryTime),
    status: raw.status as CampaignStatus,
    reclaimedTxHash: raw.reclaimedTxHash,
    createdAt: raw.createdAt,
    accounting: {
      budget: raw.accounting.budget,
      settled: raw.accounting.settled,
      remainingUnsettled: raw.accounting.remaining,
      reclaimable: raw.accounting.reclaimable,
    },
    roster: { count: raw.roster?.total ?? raw.entitlementCount },
  };
}

/** A receipt exists only for a request the backend verified against a Settlement event. */
function settlementReceiptFrom(raw: RawRequestReceipt): SettlementReceipt | null {
  if (!raw.settlementTxHash) return null;
  return {
    campaignId: raw.campaignId,
    entitlementId: raw.entitlementId as Hex,
    wallet: raw.walletAddress,
    amount: raw.amount,
    txHash: raw.settlementTxHash,
    sponsored: true,
  };
}

function claimRequestViewFrom(raw: RawRequestReceipt): ClaimRequestView {
  return {
    id: raw.requestId,
    campaignId: raw.campaignId,
    entitlementId: raw.entitlementId as Hex,
    walletAddress: raw.walletAddress,
    amount: raw.amount,
    deadline: raw.deadline,
    status: raw.status as ClaimRequestStatus,
    submitTxHash: raw.submitTxHash,
    settlementTxHash: raw.settlementTxHash,
    receipt: settlementReceiptFrom(raw),
  };
}

function issuerApprovalRequestFrom(
  raw: RawCampaignRequest,
  campaignId: string
): IssuerApprovalRequest {
  return {
    id: raw.requestId,
    campaignId,
    entitlementId: raw.entitlementId as Hex,
    walletAddress: raw.walletAddress,
    amount: raw.amount,
    deadline: raw.deadline,
    status: raw.status as ClaimRequestStatus,
    consentDigest: raw.consentDigest as Hex,
    requestedAt: raw.createdAt,
    hasIssuerApproval: raw.hasIssuerApproval,
    submitTxHash: raw.submitTxHash,
    settlementTxHash: raw.settlementTxHash,
    receipt: settlementReceiptFrom({ ...raw, campaignId }),
  };
}

const WORKFLOW_STATE_BY_REQUEST_STATUS: Record<string, WorkflowState> = {
  CONSENTED: "AWAITING_ISSUER",
  ISSUER_APPROVED: "AWAITING_RESOLVER",
  SUBMITTED: "PENDING_SUBMISSION",
  FAILED: "AWAITING_RESOLVER",
};

function lifecycleGroupFrom(status: string): LifecycleGroup {
  const normalised = status.toUpperCase();
  if (normalised === "COMPLETED") return "COMPLETED";
  if (normalised === "EXPIRED") return "EXPIRED";
  return "AVAILABLE";
}

/**
 * D-020: a funded entitlement before its opening time is still Available, but it carries an
 * opens time and is not claimable. Nothing here may ever report Completed without the
 * backend's verified settlement transaction.
 */
function nomineEntitlementFrom(entry: RawInboxEntry): NomineEntitlement {
  const campaign = campaignPublicViewFrom(entry.campaign);
  const group = lifecycleGroupFrom(entry.status);
  const opensAt = entry.opensAt ? unixSecondsFromIso(entry.opensAt) : null;

  const request: ClaimRequestView | null = entry.request
    ? {
        id: entry.request.requestId,
        campaignId: campaign.id,
        entitlementId: entry.entitlementId as Hex,
        walletAddress: entry.request.walletAddress,
        amount: entry.request.amount,
        deadline: unixSecondsFromEither(entry.request.deadline),
        status: entry.request.status as ClaimRequestStatus,
      }
    : null;

  return {
    entitlementId: entry.entitlementId as Hex,
    campaignId: campaign.id,
    campaign,
    amount: entry.request?.amount ?? campaign.allocation,
    status: group,
    workflowState: request
      ? WORKFLOW_STATE_BY_REQUEST_STATUS[request.status] ?? null
      : null,
    settlementTxHash: entry.settlementTxHash,
    claimantAddress: entry.request?.walletAddress ?? null,
    request,
    opensAt,
    claimable:
      group === "AVAILABLE" &&
      campaign.funded &&
      (opensAt === null || opensAt <= Math.floor(Date.now() / 1000)),
  };
}

/**
 * Issuer: normalize/dedup emails, assign identifiers, persist DRAFT, and return the exact
 * CampaignConfig payload the funding wallet must submit plus count, budget and root.
 */
export async function prepareNomineCampaign(
  payload: PrepareCampaignRequest
): Promise<PrepareCampaignResponse> {
  try {
    const response = await fetchWithAuth("/api/campaigns/prepare", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const raw = (await response.json()) as RawPrepareResponse;
    return {
      campaignId: raw.campaignId,
      config: raw.config,
      entitlementCount: raw.entitlementCount,
      budget: raw.budget,
      entitlementRoot: raw.entitlementRoot as Hex,
      paramsHash: raw.paramsHash,
      status: raw.status as CampaignStatus,
      mapping: (raw.mapping ?? []).map((entry) => ({
        entitlementId: entry.entitlementId as Hex,
        email: entry.email,
      })),
    };
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Issuer: verify the canonical CampaignFunded event matches the stored config exactly and mark
 * FUNDED. Idempotent.
 */
export async function confirmNomineCampaign(
  campaignId: string,
  txHash: string
): Promise<ConfirmCampaignResponse> {
  try {
    const response = await fetchWithAuth(
      `/api/campaigns/${campaignId}/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ txHash }),
      }
    );
    const raw = (await response.json()) as RawConfirmResponse;
    return {
      campaignId: raw.campaignId,
      onchainId: raw.onchainId,
      status: raw.status as CampaignStatus,
    };
  } catch (error) {
    throw normalizeError(error);
  }
}

/** Issuer: the authenticated issuer's campaigns with chain totals. */
export async function getNomineCampaigns(): Promise<NomineCampaign[]> {
  try {
    const response = await fetchWithAuth("/api/campaigns");
    const data = (await response.json()) as { campaigns?: RawCampaignSummary[] };
    return (data.campaigns ?? []).map(nomineCampaignFrom);
  } catch (error) {
    throw normalizeError(error);
  }
}

/** Issuer-only detail incl. private roster summary and accounting. */
export async function getNomineCampaign(
  campaignId: string
): Promise<NomineCampaign> {
  try {
    const response = await fetchWithAuth(`/api/campaigns/${campaignId}`);
    const data = (await response.json()) as RawCampaignSummary & {
      campaign?: RawCampaignSummary;
    };
    return nomineCampaignFrom(data.campaign ?? data);
  } catch (error) {
    throw normalizeError(error);
  }
}

/** Issuer-only approval requests (consent + wallet + amount + deadline). */
export async function getNomineCampaignRequests(
  campaignId: string
): Promise<CampaignRequestsResponse> {
  try {
    const response = await fetchWithAuth(`/api/campaigns/${campaignId}/requests`);
    const data = (await response.json()) as { requests?: RawCampaignRequest[] };
    return {
      requests: (data.requests ?? []).map((request) =>
        issuerApprovalRequestFrom(request, campaignId)
      ),
    };
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Issuer: submit the signature produced by the distinct external approval wallet. The server
 * verifies it recovers to the campaign's configured issuerApprover.
 */
export async function submitNomineIssuerApproval(
  campaignId: string,
  requestId: string,
  signature: string
): Promise<IssuerApprovalRequestResponse> {
  try {
    const response = await fetchWithAuth(
      `/api/campaigns/${campaignId}/requests/${requestId}/issuer-approval`,
      {
        method: "POST",
        body: JSON.stringify({ signature }),
      }
    );
    const raw = (await response.json()) as RawRequestReceipt;
    return {
      request: {
        id: raw.requestId,
        campaignId: raw.campaignId,
        entitlementId: raw.entitlementId as Hex,
        walletAddress: raw.walletAddress,
        amount: raw.amount,
        deadline: raw.deadline,
        status: raw.status as ClaimRequestStatus,
        hasIssuerApproval: raw.hasIssuerApproval,
        submitTxHash: raw.submitTxHash,
        settlementTxHash: raw.settlementTxHash,
        receipt: settlementReceiptFrom(raw),
      },
    };
  } catch (error) {
    throw normalizeError(error);
  }
}

/** Issuer: verify CampaignReclaimed and mark RECLAIMED. Recovery needs no approver. */
export async function confirmNomineRecovery(
  campaignId: string,
  txHash: string
): Promise<ConfirmRecoveryResponse> {
  try {
    const response = await fetchWithAuth(
      `/api/campaigns/${campaignId}/recover/confirm`,
      {
        method: "POST",
        body: JSON.stringify({ txHash }),
      }
    );
    const raw = (await response.json()) as RawRecoverResponse;
    return {
      campaignId: raw.campaignId,
      status: raw.status as CampaignStatus,
      reclaimedTxHash: raw.reclaimedTxHash,
    };
  } catch (error) {
    throw normalizeError(error);
  }
}

/** Public link view (no roster). Auth token is attached when available. */
export async function getNomineCampaignPublic(
  campaignId: string
): Promise<CampaignPublicView> {
  try {
    const response = await fetchWithAuth(`/api/campaigns/${campaignId}/public`);
    const data = (await response.json()) as RawCampaignPublicView & {
      campaign?: RawCampaignPublicView;
    };
    return campaignPublicViewFrom(data.campaign ?? data);
  } catch (error) {
    throw normalizeError(error);
  }
}

/** Claimant: the authenticated claimant's own funded entitlements. */
export async function getNomineInbox(): Promise<InboxResponse> {
  try {
    const response = await fetchWithAuth("/api/inbox");
    const data = (await response.json()) as { entries?: RawInboxEntry[] };
    return { entitlements: (data.entries ?? []).map(nomineEntitlementFrom) };
  } catch (error) {
    throw normalizeError(error);
  }
}

/** Claimant: server-side verified-email eligibility + signature check, then a CONSENTED request. */
export async function submitNomineConsent(
  campaignId: string,
  payload: SubmitConsentRequest
): Promise<SubmitConsentResponse> {
  try {
    const response = await fetchWithAuth(`/api/campaigns/${campaignId}/consent`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const raw = (await response.json()) as RawRequestReceipt;
    return { request: claimRequestViewFrom(raw) };
  } catch (error) {
    throw normalizeError(error);
  }
}

/** Owner or issuer: status + receipt for a single request. */
export async function getNomineClaimRequest(
  campaignId: string,
  requestId: string
): Promise<ClaimRequestDetailResponse> {
  try {
    const response = await fetchWithAuth(
      `/api/campaigns/${campaignId}/requests/${requestId}`
    );
    const raw = (await response.json()) as RawRequestReceipt;
    return { request: claimRequestViewFrom(raw) };
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Claimant: sponsored relay. Requires consent + issuer approval; attaches the Resolver
 * attestation and broadcasts from the relayer wallet. Idempotent and safe to retry.
 */
export async function sponsorNomineSettle(
  campaignId: string,
  requestId: string
): Promise<SettleRequestResponse> {
  try {
    const response = await fetchWithAuth(
      `/api/campaigns/${campaignId}/requests/${requestId}/settle`,
      { method: "POST" }
    );
    const raw = (await response.json()) as RawRequestReceipt;
    return { request: claimRequestViewFrom(raw) };
  } catch (error) {
    throw normalizeError(error);
  }
}
