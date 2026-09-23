import type { Drop } from "@prisma/client";
import {
  DropEventType,
  DropStatus,
  RecipientType,
  SocialIdentifierType,
  WalletType,
} from "@prisma/client";
import { ethers, JsonRpcProvider } from "ethers";
import { randomUUID } from "crypto";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import {
  ClaimConfirmRequest,
  ClaimPermitRequest,
  ClaimPermitResponse,
  ConfirmDropRequest,
  PrepareDropRequest,
  PrepareDropResponse,
  RelayClaimRequest,
  RelayClaimResponse,
  RevokeDropRequest,
  UpdateReceiverRequest,
} from "../dto/drop.dto";
import {
  computeRecipientCommit,
  dropAmountToBaseUnits,
  dropStatusToString,
  maskIdentifier,
  normalizeIdentifier,
  recipientTypeToEnum,
  recipientTypeToNumber,
  recipientTypeToString,
  requiresAuthorization,
  walletTypeToEnum,
} from "../utils/drop";
import {
  ChainEvidenceError,
  ConfigurationError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "../utils/errors";
import { CLAIM_PERMIT_DOMAIN, CLAIM_PERMIT_TYPES } from "../utils/eip712";
import { backendSigner, relayerWallet } from "../config/wallets";
import { getRpcProvider } from "../config/arcClient";
import { Contract } from "ethers";
import { GiftLinkABI, ONCHAIN_DROP_STATUS } from "../config/abi";
import { logger } from "../config/logger";
import type { AuthenticatedUser } from "../middleware/auth";
import {
  assertClaimAuthorized,
  isAddressedToUser,
} from "./recipientAuthorization";
import {
  assertConfiguredNetwork,
  assertContractConfiguration,
  assertDropMatchesChain,
  extractSettlement,
  fetchVerifiedCreation,
  fetchVerifiedRevocation,
  fetchVerifiedSettlement,
  findSettlementForGift,
  getBlockTimestamp,
  readGift,
} from "./chainEvidence";
import type { SettlementFacts } from "./chainEvidence";

const provider: JsonRpcProvider = getRpcProvider();
const TOKEN_ADDRESS = env.USDC_CONTRACT_ADDRESS.toLowerCase();

async function calculateGasTankAmount(): Promise<{
  gasTankAmount: string;
  estimatedGasCost: string;
}> {
  const GAS_LIMIT = 150_000n;
  const BUFFER_MULTIPLIER = 110n; // 10% buffer (110%)
  const BUFFER_DIVISOR = 100n;
  const WEI_TO_USDC_DIVISOR = 1_000_000_000_000n; // 1e12 (convert from 18 decimals to 6 decimals)

  try {
    // Get current gas prices
    const feeData = await provider.getFeeData();

    if (!feeData.gasPrice && !feeData.maxFeePerGas) {
      throw new Error("Unable to fetch gas prices");
    }

    // Use maxFeePerGas if available (EIP-1559), otherwise gasPrice
    const gasPrice = feeData.maxFeePerGas
      ? feeData.maxFeePerGas + (feeData.maxPriorityFeePerGas || 0n)
      : feeData.gasPrice || 0n;

    if (gasPrice === 0n) {
      throw new Error("Gas price is zero");
    }

    const gasCostInWei = GAS_LIMIT * gasPrice;

    // Convert from wei (18 decimals) to USDC (6 decimals)
    const gasCostInUSDC = gasCostInWei / WEI_TO_USDC_DIVISOR;

    // Apply 10% buffer
    const gasTankAmountWithBuffer =
      (gasCostInUSDC * BUFFER_MULTIPLIER) / BUFFER_DIVISOR;

    const gasTankAmount = gasTankAmountWithBuffer.toString();

    const estimatedGasCost = (
      Number(gasTankAmountWithBuffer) / 1_000_000
    ).toFixed(6);

    return {
      gasTankAmount,
      estimatedGasCost: `${estimatedGasCost} USDC`,
    };
  } catch (error) {
    logger.error(
      {
        operation: "calculateGasTankAmount",
        outcome: "fallback",
        errorType: error instanceof Error ? error.name : "UnknownError",
      },
      "Gas tank estimation failed; using the fallback amount"
    );
    // Fallback to a safe default (e.g., 5 USDC = 5,000,000 in 6 decimals)
    const fallbackAmount = "5000000"; // 5 USDC
    return {
      gasTankAmount: fallbackAmount,
      estimatedGasCost: "5.000000 USDC",
    };
  }
}

/**
 * Helper function to lookup a user's privyId by their identifier.
 *
 * Social identifiers are compared case-insensitively because stored values come from the
 * provider verbatim while drop identifiers are normalized to lower case; an exact-match
 * lookup means a mixed-case handle fails to match itself
 * (`docs/foundation-audit.md` §2.9).
 *
 * Returns null if the user is not found.
 */
async function lookupUserPrivyId(
  recipientType: RecipientType,
  identifier: string
): Promise<string | null> {
  try {
    const normalized = normalizeIdentifier(identifier, recipientType);
    let user: { privyId: string } | null = null;

    switch (recipientType) {
      case RecipientType.EMAIL:
        user = await prisma.user.findFirst({
          where: { email: { equals: normalized, mode: "insensitive" } },
          select: { privyId: true },
        });
        break;
      case RecipientType.DISCORD:
        user = await prisma.user.findFirst({
          where: { discordId: { equals: normalized, mode: "insensitive" } },
          select: { privyId: true },
        });
        break;
      case RecipientType.TWITTER:
        user = await prisma.user.findFirst({
          where: { twitterId: { equals: normalized, mode: "insensitive" } },
          select: { privyId: true },
        });
        break;
      case RecipientType.WALLET:
        user = await prisma.user.findUnique({
          where: { walletAddress: normalized },
          select: { privyId: true },
        });
        break;
      case RecipientType.PUBLIC:
        // PUBLIC drops don't have a specific recipient
        return null;
    }

    return user?.privyId ?? null;
  } catch (error) {
    logger.error({
      operation: "lookupUserPrivyId",
      outcome: "failure",
      recipientType: recipientTypeToString(recipientType),
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    // If lookup fails, return null (drop can still be created)
    return null;
  }
}

export async function prepareDrop(
  data: PrepareDropRequest,
  senderPrivyId?: string
): Promise<PrepareDropResponse> {
  // Validate input
  if (!data.senderAddress || !ethers.isAddress(data.senderAddress)) {
    throw new ValidationError("Invalid sender address");
  }

  if (data.message && data.message.length > 280) {
    throw new ValidationError("Message too long (max 280 chars)");
  }

  const dropId = randomUUID();
  const recipientType = recipientTypeToEnum(data.recipientType);
  const walletType = walletTypeToEnum(data.walletType);
  const isPublicDrop = recipientType === RecipientType.PUBLIC;

  // Normalize and compute commitment
  const normalizedIdentifier = normalizeIdentifier(
    data.recipientIdentifier,
    recipientType
  );

  const recipientCommit = computeRecipientCommit(
    recipientType,
    normalizedIdentifier,
    dropId
  );

  const recipientDisplay = maskIdentifier(normalizedIdentifier, recipientType);

  // Look up recipient if they're already on the platform (optional - allows sending to non-users)
  let recipientPrivyId: string | null = null;
  if (!isPublicDrop) {
    recipientPrivyId = await lookupUserPrivyId(
      recipientType,
      normalizedIdentifier
    );

    // Prevent sending to yourself (only if recipient exists on platform)
    if (
      senderPrivyId &&
      recipientPrivyId &&
      recipientPrivyId === senderPrivyId
    ) {
      throw new ValidationError("You cannot send a drop to yourself");
    }
  }

  // Calculate gas tank amount for relayer reimbursement
  const { gasTankAmount, estimatedGasCost } = await calculateGasTankAmount();

  // Calculate total amount (drop amount + gas tank)
  // `data.amount` is the human-unit string the sender typed; the contract and the gas tank
  // are in base units, so the conversion happens here, once.
  const dropAmount = dropAmountToBaseUnits(data.amount);
  const gasTankAmountBigInt = BigInt(gasTankAmount);
  const totalAmount = (dropAmount + gasTankAmountBigInt).toString();

  // Save to database
  await prisma.drop.create({
    data: {
      id: dropId,
      senderAddress: data.senderAddress.toLowerCase(),
      senderPrivyId: senderPrivyId ?? null,
      senderIdentifier: data.senderIdentifier ?? null,
      recipientType: recipientType,
      recipientIdentifier: normalizedIdentifier,
      recipientPrivyId: recipientPrivyId,
      recipientCommit,
      amount: data.amount,
      gasTankAmount,
      estimatedGasCost,
      message: data.message ?? null,
      isAnonymous: data.isAnonymous ?? false,
      status: DropStatus.PENDING,
      expiry: data.expiry ? new Date(data.expiry * 1000) : null,
      senderWalletType: walletType,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return {
    dropId,
    recipientCommit,
    gasTankAmount,
    totalAmount,
    estimatedGasCost,
    contractParams: {
      recipientCommit,
      recipientType: recipientTypeToNumber(recipientType),
      expiry: data.expiry ?? 0,
    },
    summary: {
      amount: data.amount,
      token: TOKEN_ADDRESS,
      recipientDisplay,
    },
  };
}

// ========================================
// CONFIRM DROP
// ========================================

/**
 * Binds a database gift to the gift the chain actually funded.
 *
 * Previously this wrote the caller's `onchainId` and `txHash` verbatim, so a forged
 * mapping could attach a valid creation event to the wrong gift
 * (`docs/foundation-audit.md` §1.3, §2.5). The binding now comes from the contract's own
 * `DropCreated` event, and the funded gift must agree with this gift's recipient
 * commitment, type, amount, gas tank and expiry - all of which are fixed on-chain by the
 * sender's own transaction and cannot be chosen by the caller.
 *
 * Idempotent: repeating a confirmation with the same evidence converges on the existing
 * binding; a different binding is rejected rather than silently replaced.
 */
export async function confirmDrop(
  { dropId, onchainId, txHash }: ConfirmDropRequest,
  authUser?: AuthenticatedUser
): Promise<{ onchainId: string }> {
  const drop = await prisma.drop.findUnique({ where: { id: dropId } });
  if (!drop) {
    throw new NotFoundError("Drop not found");
  }

  const creatorPrivyId = authUser?.privyUserId;
  if (!creatorPrivyId) {
    throw new ForbiddenError("Authenticated user is required");
  }

  // Ownership is anchored on the authenticated creator, not an optional argument.
  if (drop.senderPrivyId !== creatorPrivyId) {
    throw new ForbiddenError("Only the sender can confirm this drop");
  }

  const requestedOnchainId =
    typeof onchainId === "bigint" ? onchainId : BigInt(onchainId);

  if (drop.onchainId !== null && drop.onchainId !== undefined) {
    if (
      drop.onchainId === requestedOnchainId &&
      drop.creationTxHash === txHash
    ) {
      // Same evidence, already bound: converge.
      return { onchainId: drop.onchainId.toString() };
    }
    throw new ChainEvidenceError(
      `This gift is already bound to on-chain gift ${drop.onchainId.toString()} via transaction ${
        drop.creationTxHash ?? "unknown"
      }. Refusing to rebind it to ${requestedOnchainId.toString()}.`
    );
  }

  if (drop.status !== DropStatus.PENDING) {
    throw new ValidationError(
      `Drop is not pending (current status: ${dropStatusToString(drop.status)})`
    );
  }

  const creation = await fetchVerifiedCreation(txHash, {
    contractAddress: env.GIFTLINK_CONTRACT_ADDRESS,
    onchainId: requestedOnchainId,
  });

  // The funded gift must be this gift. Every one of these values was fixed by the
  // sender's transaction, so a mismatch means the event belongs to a different gift.
  const disagreements: string[] = [];

  if (creation.recipientCommit.toLowerCase() !== drop.recipientCommit.toLowerCase()) {
    disagreements.push("recipient commitment");
  }

  if (creation.recipientType !== recipientTypeToNumber(drop.recipientType)) {
    disagreements.push("recipient type");
  }

  if (creation.amount !== dropAmountToBaseUnits(drop.amount)) {
    disagreements.push("amount");
  }

  if (
    drop.gasTankAmount != null &&
    creation.gasTankAmount.toString() !== drop.gasTankAmount
  ) {
    disagreements.push("gas tank");
  }

  const expectedExpiry = drop.expiry
    ? BigInt(Math.floor(drop.expiry.getTime() / 1000))
    : 0n;
  if (creation.expiry !== expectedExpiry) {
    disagreements.push("expiry");
  }

  if (disagreements.length > 0) {
    throw new ChainEvidenceError(
      `Transaction ${txHash} created a gift that does not match this gift (${disagreements.join(
        ", "
      )}). Refusing to bind them.`
    );
  }

  if (authUser.walletAddresses.length === 0) {
    throw new ForbiddenError(
      "No wallet is linked to your account. Connect the wallet that funded this gift, then confirm again."
    );
  }

  const fundedByLinkedWallet = authUser.walletAddresses.some(
    (address) => address.toLowerCase() === creation.sender.toLowerCase()
  );
  if (!fundedByLinkedWallet) {
    throw new ForbiddenError(
      `This gift was funded by ${creation.sender}, which is not linked to your account. ` +
        "Link the funding wallet, or confirm from the account that funded it."
    );
  }

  // One on-chain gift may not back two database gifts.
  const conflict = await prisma.drop.findFirst({
    where: {
      onchainId: requestedOnchainId,
      NOT: { id: dropId },
    },
    select: { id: true },
  });
  if (conflict) {
    throw new ChainEvidenceError(
      `On-chain gift ${requestedOnchainId.toString()} is already bound to another gift. ` +
        "Refusing to create a duplicate binding."
    );
  }

  if (
    drop.senderAddress.toLowerCase() !== creation.sender.toLowerCase()
  ) {
    logger.warn(
      {
        operation: "confirmDrop",
        outcome: "sender_corrected",
        dropId,
        recordedSender: drop.senderAddress,
        chainSender: creation.sender,
      },
      "Stored sender differed from the funding wallet; recording the chain value"
    );
  }

  await prisma.$transaction([
    prisma.drop.update({
      where: { id: dropId },
      data: {
        onchainId: requestedOnchainId,
        creationTxHash: creation.txHash,
        // The chain is authoritative for the payer (D-004).
        senderAddress: creation.sender,
        status: DropStatus.ACTIVE,
        updatedAt: new Date(),
      },
    }),
    prisma.dropEvent.create({
      data: {
        dropId,
        eventType: DropEventType.CREATED,
        actorAddress: creation.sender,
        txHash: creation.txHash,
        metadata: {
          onchainId: requestedOnchainId.toString(),
          blockNumber: creation.blockNumber,
        },
      },
    }),
  ]);

  logger.info(
    {
      operation: "confirmDrop",
      outcome: "bound",
      dropId,
      onchainId: requestedOnchainId.toString(),
      txHash: creation.txHash,
    },
    "Gift creation confirmed against chain evidence"
  );

  return { onchainId: requestedOnchainId.toString() };
}

export async function getDropDetails(
  dropId: string,
  authUser?: AuthenticatedUser
) {
  const drop = await prisma.drop.findUnique({ where: { id: dropId } });
  if (!drop) {
    throw new NotFoundError("Drop not found");
  }

  const summary = mapDropToSummary(drop);

  // Display only, and deliberately computed from the same verified evidence the
  // enforcement path uses so the UI cannot advertise a claim the backend would refuse.
  const canClaim = isAddressedToUser(drop, authUser);

  return {
    ...summary,
    canClaim,
  };
}

export async function issueClaimPermit(
  dropId: string,
  request: ClaimPermitRequest,
  authUser?: AuthenticatedUser,
  oauthProvider: string = "privy"
): Promise<ClaimPermitResponse> {
  const drop = await prisma.drop.findUnique({ where: { id: dropId } });
  if (!drop) {
    throw new NotFoundError("Drop not found");
  }

  if (!drop.onchainId) {
    throw new ValidationError("Drop is not confirmed on-chain yet");
  }

  if (drop.status !== DropStatus.ACTIVE) {
    throw new ValidationError(`Drop is ${dropStatusToString(drop.status)}`);
  }

  if (drop.expiry && drop.expiry.getTime() <= Date.now()) {
    throw new ValidationError("Drop has expired");
  }

  const claimerAddress = request.claimerAddress.toLowerCase();

  // One recipient policy, shared with the relay endpoint, so this route cannot bypass
  // the checks the payout route applies. It runs before the chain is consulted, so an
  // unauthenticated or unrelated caller learns nothing about on-chain state.
  // The identity is taken from verified provider data; `request.claimerIdentifier` is
  // accepted for caller compatibility and deliberately not used, because a
  // caller-supplied identifier proves nothing.
  const { matchedIdentity } = assertClaimAuthorized({
    drop,
    authUser,
    payoutAddress: claimerAddress,
    walletEvidence: "privy-linked",
  });

  // Nothing is signed until the deployment and the chain agree with this record.
  await assertConfiguredNetwork(provider);
  await assertContractConfiguration(provider);
  await assertDropMatchesChain(drop, provider);

  if (matchedIdentity) {
    const identifierHash = ethers.keccak256(
      ethers.toUtf8Bytes(matchedIdentity)
    );

    const identifierType = mapRecipientTypeToSocialIdentifier(
      drop.recipientType
    );
    if (identifierType) {
      await prisma.socialIdentity.upsert({
        where: {
          identifierHash_walletAddress: {
            identifierHash,
            walletAddress: claimerAddress,
          },
        },
        update: {
          identifierRaw: matchedIdentity,
          oauthProvider,
          lastVerifiedAt: new Date(),
        },
        create: {
          identifierType,
          identifierRaw: matchedIdentity,
          identifierHash,
          walletAddress: claimerAddress,
          oauthProvider,
        },
      });
    }
  }

  const domain = CLAIM_PERMIT_DOMAIN(
    env.CHAIN_ID,
    env.GIFTLINK_CONTRACT_ADDRESS,
    env.EIP712_DOMAIN_NAME,
    env.EIP712_VERSION
  );

  const permitExpiry = Math.floor(Date.now() / 1000) + 3600;
  const typedData = {
    dropId: drop.onchainId,
    claimer: request.claimerAddress,
    expiry: permitExpiry,
  };

  const signature = await backendSigner.signTypedData(
    domain,
    CLAIM_PERMIT_TYPES,
    typedData
  );

  const dropIdForResponse = Number(drop.onchainId);
  if (!Number.isSafeInteger(dropIdForResponse)) {
    throw new ValidationError(
      "On-chain dropId exceeds safe integer range for response"
    );
  }

  return {
    permit: {
      dropId: dropIdForResponse,
      claimer: request.claimerAddress,
      expiry: permitExpiry,
    },
    signature,
    dropDetails: {
      amount: drop.amount,
      token: TOKEN_ADDRESS,
    },
  };
}

// ========================================
// RELAY CLAIM
// ========================================

/**
 * Proves the caller controls the payout address by checking the challenge signature.
 *
 * The message format is deliberately unchanged so existing clients keep working. It
 * proves control of an address and nothing else: it says nothing about whether that
 * address belongs to the gift's intended recipient, which is what the recipient policy
 * decides separately.
 */
function assertClaimerControlsPayoutAddress(
  onchainId: bigint,
  request: RelayClaimRequest,
  rawAddress: string
): void {
  const currentTime = Math.floor(Date.now() / 1000);
  const timestampAge = currentTime - request.timestamp;
  const MAX_TIMESTAMP_AGE = 5 * 60; // 5 minutes in seconds

  if (timestampAge < 0) {
    throw new ValidationError("Timestamp is in the future");
  }
  if (timestampAge > MAX_TIMESTAMP_AGE) {
    throw new ValidationError(
      "Signature timestamp is too old (max 5 minutes)"
    );
  }

  const message = `GiftLink Claim Authorization
Drop ID: ${onchainId}
Claimer: ${rawAddress}
Timestamp: ${request.timestamp}`;

  let recoveredAddress: string;
  try {
    recoveredAddress = ethers.verifyMessage(message, request.claimerSignature);
  } catch {
    throw new ValidationError("Invalid claimer signature");
  }

  // Address comparison is case-insensitive; EIP-191 recovery returns a checksummed form.
  if (recoveredAddress.toLowerCase() !== rawAddress.toLowerCase()) {
    throw new ForbiddenError(
      "Claimer signature does not match claimer address"
    );
  }
}

/**
 * Relay a claim. This is the one backend path that moves USDC.
 *
 * Three gates run in order, and all of them complete before a permit is signed or any
 * relay gas is spent:
 *
 * 1. the caller proves control of the payout address by signing the challenge;
 * 2. the recipient policy authorizes this caller for this gift, using verified provider
 *    data rather than anything the caller asserts;
 * 3. the deployment and the chain are checked, and the stored gift must agree with the
 *    contract's own record of it.
 *
 * The settlement is then verified from the contract's canonical event, so a successful
 * receipt on its own is never enough to record a payout.
 */
export async function relayClaim(
  dropId: string,
  request: RelayClaimRequest,
  authUser?: AuthenticatedUser
): Promise<RelayClaimResponse> {
  const drop = await prisma.drop.findUnique({ where: { id: dropId } });
  if (!drop) {
    throw new NotFoundError("Drop not found");
  }

  if (!drop.onchainId) {
    throw new ValidationError("Drop is not confirmed on-chain yet");
  }

  if (!drop.gasTankAmount) {
    throw new ValidationError("Gas tank amount not set for this drop");
  }

  const payoutAddress = request.claimer.toLowerCase();

  // 1. The caller controls the payout address.
  assertClaimerControlsPayoutAddress(drop.onchainId, request, request.claimer);

  // 2. The recipient policy authorizes this caller for this gift.
  assertClaimAuthorized({
    drop,
    authUser,
    payoutAddress,
    walletEvidence: "signature",
  });

  // 3. The deployment and the chain must agree with this record before anything is signed.
  await assertConfiguredNetwork(provider);
  await assertContractConfiguration(provider);
  const onchain = await assertDropMatchesChain(drop, provider);

  if (onchain.status === ONCHAIN_DROP_STATUS.CLAIMED) {
    // A retry after a chain success that never reached the client. Converge on the
    // settlement the contract already recorded instead of paying a second time.
    return reconcileExistingSettlement(drop, payoutAddress, authUser);
  }

  if (onchain.status !== ONCHAIN_DROP_STATUS.ACTIVE) {
    throw new ValidationError(
      `Gift is no longer claimable on-chain (status ${onchain.status})`
    );
  }

  if (drop.status !== DropStatus.ACTIVE) {
    throw new ValidationError(`Drop is ${dropStatusToString(drop.status)}`);
  }

  if (drop.expiry && drop.expiry.getTime() <= Date.now()) {
    throw new ValidationError("Drop has expired");
  }

  const domain = CLAIM_PERMIT_DOMAIN(
    env.CHAIN_ID,
    env.GIFTLINK_CONTRACT_ADDRESS,
    env.EIP712_DOMAIN_NAME,
    env.EIP712_VERSION
  );

  const permitExpiry = Math.floor(Date.now() / 1000) + 3600;
  const permitSignature = await backendSigner.signTypedData(
    domain,
    CLAIM_PERMIT_TYPES,
    {
      dropId: drop.onchainId,
      claimer: payoutAddress,
      expiry: permitExpiry,
    }
  );

  // Check relayer balance (native gas token)
  const relayerBalance = await provider.getBalance(relayerWallet.address);
  if (relayerBalance === 0n) {
    throw new ServiceUnavailableError(
      "Relayer has insufficient balance for gas"
    );
  }

  const contract = new Contract(
    env.GIFTLINK_CONTRACT_ADDRESS,
    GiftLinkABI,
    relayerWallet.connect(provider)
  );

  let receipt;
  try {
    const tx = await contract.claimWithPermit(
      drop.onchainId,
      payoutAddress,
      permitExpiry,
      permitSignature
    );

    logger.info(
      {
        operation: "relayClaim",
        outcome: "submitted",
        dropId,
        onchainId: drop.onchainId.toString(),
        txHash: tx.hash,
      },
      "Claim transaction submitted"
    );

    receipt = await tx.wait();
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown submission error";

    if (message.includes("insufficient funds")) {
      logger.error({
        operation: "relayClaim",
        outcome: "relayer_funds",
        dropId,
        onchainId: drop.onchainId.toString(),
      });
      throw new ServiceUnavailableError(
        "Relayer has insufficient balance for gas"
      );
    }

    // A reverted submission can still mean an earlier attempt already settled this gift.
    if (message.includes("Drop not active")) {
      return reconcileExistingSettlement(drop, payoutAddress, authUser);
    }

    logger.error({
      operation: "relayClaim",
      outcome: "transaction_failed",
      dropId,
      onchainId: drop.onchainId.toString(),
      errorMessage: message,
    });
    throw new ValidationError(`Claim transaction failed: ${message}`);
  }

  // 4. The settlement comes from the contract's own event, not from the receipt status.
  const facts = extractSettlement(receipt, {
    contractAddress: env.GIFTLINK_CONTRACT_ADDRESS,
    onchainId: drop.onchainId,
  });

  if (facts.claimer !== payoutAddress) {
    throw new ChainEvidenceError(
      `Transaction ${facts.txHash} settled gift ${drop.onchainId.toString()} to ${facts.claimer}, ` +
        `not ${payoutAddress}. Refusing to record it against this claim.`
    );
  }

  await persistSettlement({
    drop,
    facts,
    expectedAmount: onchain.amount,
    authUser,
  });

  return {
    txHash: facts.txHash,
    amounts: {
      claimerReceived: facts.amountToClaimer.toString(),
      relayerReimbursed: facts.amountToRelayer.toString(),
    },
  };
}

/**
 * Converges on a settlement the contract already recorded.
 *
 * Used when the chain reports the gift as claimed: either the previous attempt actually
 * landed, or someone else settled it. The existing canonical event supplies every
 * recorded fact, so a lost response costs nothing and can never produce a second payout.
 */
async function reconcileExistingSettlement(
  drop: Drop,
  payoutAddress: string,
  authUser?: AuthenticatedUser
): Promise<RelayClaimResponse> {
  if (!drop.onchainId) {
    throw new ValidationError("Drop is not confirmed on-chain yet");
  }

  const facts = await findSettlementForGift(drop.onchainId);
  if (!facts) {
    throw new ConfigurationError(
      `Gift ${drop.onchainId.toString()} is claimed on-chain, but no DropClaimed event for it could be read. ` +
        "Refusing to guess what happened to it."
    );
  }

  if (facts.claimer !== payoutAddress) {
    throw new ForbiddenError(
      "This gift has already been settled to a different address"
    );
  }

  const gift = await readGift(drop.onchainId);

  await persistSettlement({
    drop,
    facts,
    expectedAmount: gift.amount,
    authUser,
  });

  return {
    txHash: facts.txHash,
    amounts: {
      claimerReceived: facts.amountToClaimer.toString(),
      relayerReimbursed: facts.amountToRelayer.toString(),
    },
  };
}

/**
 * Writes the one canonical settlement record for a gift, from verified chain facts.
 *
 * Amounts, payer, recipient and completion all come from the decoded event. Repeated or
 * concurrent confirmations of the same settlement converge; a different settlement for an
 * already-settled gift is rejected rather than merged.
 *
 * `expectedAmount` is the gift's own amount as the contract holds it. Checking the event
 * against it is what rejects a `DropClaimed` event that names this gift but reports a
 * different payout.
 */
async function persistSettlement({
  drop,
  facts,
  expectedAmount,
  authUser,
}: {
  drop: Drop;
  facts: SettlementFacts;
  expectedAmount: bigint;
  authUser?: AuthenticatedUser;
}): Promise<void> {
  if (facts.amountToClaimer !== expectedAmount) {
    throw new ChainEvidenceError(
      `Transaction ${facts.txHash} reports a payout of ${facts.amountToClaimer.toString()} ` +
        `for gift ${facts.onchainId.toString()}, but the contract holds ${expectedAmount.toString()} ` +
        "for it. Refusing to record a settlement that does not match the gift."
    );
  }

  const claimedAt = (await getBlockTimestamp(facts.blockNumber)) ?? new Date();
  const walletKind = authUser?.walletKinds[facts.claimer];
  const claimerWalletType =
    walletKind === "privy"
      ? WalletType.PRIVY
      : walletKind === "external"
        ? WalletType.EXTERNAL
        : null;

  const outcome = await prisma.$transaction(async (tx) => {
    // Single conditional UPDATE, so exactly one caller can ever claim the row for a given
    // settlement: a concurrent retry blocks on the row lock and then fails this predicate
    // instead of also reporting success and writing a second audit record.
    const updated = await tx.drop.updateMany({
      where: {
        id: drop.id,
        claimTxHash: null,
      },
      data: {
        status: DropStatus.CLAIMED,
        claimTxHash: facts.txHash,
        claimerAddress: facts.claimer,
        claimerWalletType,
        claimerIdentifier:
          drop.recipientType === RecipientType.PUBLIC
            ? null
            : drop.recipientIdentifier,
        relayerAddress: facts.relayer,
        recipientPrivyId: drop.recipientPrivyId ?? authUser?.privyUserId ?? null,
        claimedAt,
        updatedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      const current = await tx.drop.findUnique({
        where: { id: drop.id },
        select: { claimTxHash: true },
      });

      if (current?.claimTxHash === facts.txHash) {
        return "converged";
      }

      throw new ChainEvidenceError(
        `Gift already records settlement transaction ${
          current?.claimTxHash ?? "unknown"
        }. Refusing to replace it with ${facts.txHash}.`
      );
    }

    await tx.dropEvent.create({
      data: {
        dropId: drop.id,
        eventType: DropEventType.CLAIMED,
        actorAddress: facts.claimer,
        txHash: facts.txHash,
        metadata: {
          onchainId: facts.onchainId.toString(),
          amountToClaimer: facts.amountToClaimer.toString(),
          amountToRelayer: facts.amountToRelayer.toString(),
          blockNumber: facts.blockNumber,
        },
      },
    });

    return "recorded";
  });

  logger.info(
    {
      operation: "recordSettlement",
      outcome,
      dropId: drop.id,
      onchainId: facts.onchainId.toString(),
      txHash: facts.txHash,
    },
    "Settlement recorded from chain evidence"
  );
}

/**
 * Records a settlement that already happened on-chain.
 *
 * This endpoint previously accepted any successful transaction hash and wrote the
 * caller's own claimer address and wallet type into the settlement record
 * (`docs/foundation-audit.md` §2.5). It now requires the configured contract's canonical
 * `DropClaimed` event for this gift, takes every recorded fact from that event, and
 * requires the caller to be the claimant the event names.
 *
 * Chain state wins over a stale local status: a settlement the chain confirms is recorded
 * even if this row was locally marked expired, because D-004 makes the chain authoritative
 * for settlement.
 */
export async function recordDropClaim(
  dropId: string,
  request: ClaimConfirmRequest,
  authUser?: AuthenticatedUser
): Promise<void> {
  const drop = await prisma.drop.findUnique({ where: { id: dropId } });
  if (!drop) {
    throw new NotFoundError("Drop not found");
  }

  if (drop.onchainId === null || drop.onchainId === undefined) {
    throw new ValidationError("Drop is not confirmed on-chain yet");
  }

  // Already recorded from this exact evidence: converge. A retry must not fail merely
  // because the claimant's wallet is no longer the one linked to their account, and no
  // state changes here, so there is nothing to protect.
  if (drop.status === DropStatus.CLAIMED && drop.claimTxHash === request.txHash) {
    return;
  }

  await assertConfiguredNetwork(provider);
  await assertContractConfiguration(provider);

  const facts = await fetchVerifiedSettlement(request.txHash, {
    contractAddress: env.GIFTLINK_CONTRACT_ADDRESS,
    onchainId: drop.onchainId,
  });

  // The caller must be the claimant the chain names, under the same recipient policy the
  // payout paths use. This is what stops one account attaching someone else's settlement
  // to itself: this request carries no signature, so the caller's only evidence is their
  // authenticated account, and the payout address must be theirs for every gift type.
  assertClaimAuthorized({
    drop,
    authUser,
    payoutAddress: facts.claimer,
    walletEvidence: "privy-linked",
  });

  const gift = await readGift(drop.onchainId);

  await persistSettlement({
    drop,
    facts,
    expectedAmount: gift.amount,
    authUser,
  });
}

export async function recordDropRevocation(
  dropId: string,
  request: RevokeDropRequest,
  senderPrivyId: string
): Promise<void> {
  const drop = await prisma.drop.findUnique({
    where: { onchainId: Number(dropId) },
  });
  if (!drop) {
    throw new NotFoundError("Drop not found");
  }

  if (drop.senderPrivyId !== senderPrivyId) {
    throw new ForbiddenError("Only the sender can revoke this drop");
  }

  if (drop.status === DropStatus.REVOKED) {
    return;
  }

  if (drop.status === DropStatus.CLAIMED) {
    throw new ValidationError("Cannot revoke a claimed drop");
  }

  if (!drop.onchainId) {
    throw new ValidationError("Drop is not confirmed on-chain yet");
  }

  // The revocation is only real if the configured contract says so for this gift.
  const revocation = await fetchVerifiedRevocation(request.txHash, {
    contractAddress: env.GIFTLINK_CONTRACT_ADDRESS,
    onchainId: drop.onchainId,
  });

  await prisma.$transaction([
    prisma.drop.update({
      where: { id: drop.id },
      data: {
        status: DropStatus.REVOKED,
        revokeTxHash: revocation.txHash,
        updatedAt: new Date(),
      },
    }),
    prisma.dropEvent.create({
      data: {
        dropId: drop.id,
        eventType: DropEventType.REVOKED,
        actorAddress: revocation.sender,
        txHash: revocation.txHash,
        metadata: {
          onchainId: revocation.onchainId.toString(),
          totalRefunded: revocation.totalRefunded.toString(),
          blockNumber: revocation.blockNumber,
        },
      },
    }),
  ]);
}

export async function updateDropReceiver(
  dropId: string,
  request: UpdateReceiverRequest,
  senderPrivyId: string
) {
  const drop = await prisma.drop.findUnique({ where: { id: dropId } });
  if (!drop) {
    throw new NotFoundError("Drop not found");
  }

  if (drop.senderPrivyId !== senderPrivyId) {
    throw new ForbiddenError("Only the sender can update the receiver");
  }

  if (drop.status !== DropStatus.ACTIVE) {
    throw new ValidationError("Only active drops can update receiver");
  }

  // Deliberate behaviour change, and a narrow one: once a gift is funded, the commitment
  // that authorizes a claim lives on-chain, and this service cannot change it - the
  // contract requires the sender's own wallet to call `updateReceiver`, and nothing in
  // this application does. Writing a new commitment to the database only would leave the
  // two disagreeing, and the claim path now refuses to authorize from contradictory data,
  // so the gift would silently become unclaimable. Refusing here keeps the database and
  // the chain in step; see the PR for the follow-up that would re-enable editing.
  if (drop.onchainId !== null && drop.onchainId !== undefined) {
    throw new ConfigurationError(
      "This gift is already funded on-chain, so its recipient commitment cannot be changed from here. " +
        "The contract only accepts a change from the sender's wallet. Revoke this gift and create a new one instead."
    );
  }

  const recipientType = recipientTypeToEnum(request.newRecipientType);
  const normalizedIdentifier = normalizeIdentifier(
    request.newRecipientIdentifier,
    recipientType
  );
  const newRecipientCommit = computeRecipientCommit(
    recipientType,
    normalizedIdentifier,
    drop.id
  );

  // Try to lookup new recipient's privyId
  const newRecipientPrivyId = await lookupUserPrivyId(
    recipientType,
    normalizedIdentifier
  );

  await prisma.$transaction([
    prisma.drop.update({
      where: { id: dropId },
      data: {
        recipientIdentifier: normalizedIdentifier,
        recipientType,
        recipientPrivyId: newRecipientPrivyId,
        recipientCommit: newRecipientCommit,
        updatedAt: new Date(),
      },
    }),
    prisma.dropEvent.create({
      data: {
        dropId,
        eventType: DropEventType.RECEIVER_UPDATED,
        metadata: {
          recipientType: request.newRecipientType,
        },
      },
    }),
  ]);

  return {
    newRecipientCommit,
    recipientDisplay: maskIdentifier(normalizedIdentifier, recipientType),
  };
}

export async function getSentDrops(
  privyId: string,
  status?: string,
  limit = 50,
  offset = 0
) {
  const where: any = {
    senderPrivyId: privyId,
  };

  if (status) {
    where.status = dropStatusFromString(status);
  } else {
    // Exclude pending drops by default - only return active, claimed, expired, or revoked drops
    where.status = {
      not: DropStatus.PENDING,
    };
  }

  const [drops, total] = await prisma.$transaction([
    prisma.drop.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    }),
    prisma.drop.count({ where }),
  ]);

  return {
    drops: drops.map(mapDropToUserResponse),
    pagination: {
      total,
      limit,
      offset,
    },
  };
}

export async function getReceivedDrops(
  privyId: string,
  limit = 50,
  offset = 0
) {
  const where = {
    recipientPrivyId: privyId,
    status: DropStatus.CLAIMED,
  };

  const [drops, total] = await prisma.$transaction([
    prisma.drop.findMany({
      where,
      orderBy: { claimedAt: "desc" },
      skip: offset,
      take: limit,
    }),
    prisma.drop.count({ where }),
  ]);

  return {
    drops: drops.map(mapDropToUserResponse),
    pagination: {
      total,
      limit,
      offset,
    },
  };
}

export async function getClaimableDrops(privyId: string) {
  // First, get the user to find their identifiers
  const user = await prisma.user.findUnique({
    where: { privyId },
    select: { email: true, discordId: true, twitterId: true },
  });

  if (!user) {
    return [];
  }

  // Build list of identifiers to match. Social handles are normalized the same way drop
  // identifiers are (lower-cased at prepare time), so a mixed-case stored handle matches
  // itself instead of disappearing from the recipient's inbox (`docs/foundation-audit.md` §2.9).
  const identifiers: string[] = [];
  if (user.email) identifiers.push(user.email.trim().toLowerCase());
  if (user.discordId) identifiers.push(user.discordId.trim().toLowerCase());
  if (user.twitterId) identifiers.push(user.twitterId.trim().toLowerCase());

  if (identifiers.length === 0) {
    return [];
  }

  const drops = await prisma.drop.findMany({
    where: {
      status: DropStatus.ACTIVE,
      recipientIdentifier: { in: identifiers },
      OR: [
        { expiry: null },
        {
          expiry: {
            gt: new Date(),
          },
        },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  return drops.map(mapDropToUserResponse);
}

export async function getStatsOverview() {
  const [
    totalDrops,
    activeDrops,
    claimedDrops,
    uniqueSendersResult,
    uniqueClaimersResult,
    claimedAmounts,
  ] = await Promise.all([
    prisma.drop.count(),
    prisma.drop.count({ where: { status: DropStatus.ACTIVE } }),
    prisma.drop.count({ where: { status: DropStatus.CLAIMED } }),
    prisma.drop.groupBy({
      by: ["senderPrivyId"],
      where: { senderPrivyId: { not: null } },
    }),
    prisma.drop.groupBy({
      by: ["recipientPrivyId"],
      where: {
        status: DropStatus.CLAIMED,
        recipientPrivyId: { not: null },
      },
    }),
    prisma.drop.findMany({
      where: { status: DropStatus.CLAIMED },
      select: { amount: true },
    }),
  ]);

  const uniqueSenders = uniqueSendersResult.length;
  const uniqueClaimers = uniqueClaimersResult.length;

  const totalVolume = claimedAmounts.reduce(
    (acc: bigint, current: { amount: string }) => {
      try {
        return acc + BigInt(current.amount);
      } catch {
        return acc;
      }
    },
    0n
  );

  return {
    totalDrops,
    activeDrops,
    claimedDrops,
    totalVolume: totalVolume.toString(),
    uniqueSenders,
    uniqueClaimers,
  };
}

function mapDropToSummary(drop: Drop) {
  const isExpired =
    drop.status === DropStatus.ACTIVE &&
    drop.expiry != null &&
    drop.expiry.getTime() <= Date.now();

  return {
    id: drop.id,
    onchainId: drop.onchainId ? drop.onchainId.toString() : null,
    status: isExpired ? "expired" : dropStatusToString(drop.status),
    amount: drop.amount,
    token: TOKEN_ADDRESS,
    message: drop.message,
    expiresAt: drop.expiry ? drop.expiry.toISOString() : null,
    isAnonymous: drop.isAnonymous,
    sender: drop.isAnonymous
      ? null
      : {
          address: maskIdentifier(drop.senderAddress, RecipientType.WALLET),
          identifier: drop.senderIdentifier,
        },
    recipientType: recipientTypeToString(drop.recipientType),
    recipientDisplay: maskIdentifier(
      drop.recipientIdentifier,
      drop.recipientType
    ),
    canClaim: false,
    claimRequiresAuth: requiresAuthorization(drop.recipientType),
    alreadyClaimed:
      drop.status === DropStatus.CLAIMED && drop.claimerAddress
        ? {
            address: drop.claimerAddress,
            claimedAt: drop.claimedAt ? drop.claimedAt.toISOString() : null,
          }
        : undefined,
  };
}

function mapDropToUserResponse(drop: Drop) {
  const summary = mapDropToSummary(drop);
  return {
    ...summary,
    onchainId: drop.onchainId ? drop.onchainId.toString() : null,
    claimer: drop.claimerAddress
      ? {
          address: drop.claimerAddress,
          identifier: drop.claimerIdentifier,
        }
      : null,
    links: {
      claim: `${env.FRONTEND_URL}/claim/${drop.id}`,
      view: `${env.FRONTEND_URL}/drops/${drop.id}`,
    },
    transactions: {
      creation: drop.creationTxHash,
      claim: drop.claimTxHash,
      revoke: drop.revokeTxHash,
    },
  };
}

function mapRecipientTypeToSocialIdentifier(
  type: RecipientType
): SocialIdentifierType | null {
  switch (type) {
    case RecipientType.EMAIL:
      return SocialIdentifierType.EMAIL;
    case RecipientType.DISCORD:
      return SocialIdentifierType.DISCORD;
    case RecipientType.TWITTER:
      return SocialIdentifierType.TWITTER;
    default:
      return null;
  }
}

function dropStatusFromString(status: string): DropStatus {
  switch (status.toLowerCase()) {
    case "pending":
      return DropStatus.PENDING;
    case "active":
      return DropStatus.ACTIVE;
    case "claimed":
      return DropStatus.CLAIMED;
    case "revoked":
      return DropStatus.REVOKED;
    case "expired":
      return DropStatus.EXPIRED;
    default:
      throw new ValidationError(`Invalid drop status filter: ${status}`);
  }
}
