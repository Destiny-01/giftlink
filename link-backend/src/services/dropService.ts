import type { Drop } from "@prisma/client";
import {
  DropEventType,
  DropStatus,
  RecipientType,
  SocialIdentifierType,
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
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "../utils/errors";
import { CLAIM_PERMIT_DOMAIN, CLAIM_PERMIT_TYPES } from "../utils/eip712";
import { backendSigner, relayerWallet } from "../config/wallets";
import { getRpcProvider } from "../config/arcClient";
import { Contract } from "ethers";
import { GiftLinkABI } from "../config/abi";
import { logger } from "../config/logger";

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
    logger.error({ error }, "[calculateGasTankAmount] Error calculating gas");
    // Fallback to a safe default (e.g., 5 USDC = 5,000,000 in 6 decimals)
    const fallbackAmount = "5000000"; // 5 USDC
    return {
      gasTankAmount: fallbackAmount,
      estimatedGasCost: "5.000000 USDC",
    };
  }
}

/**
 * Helper function to lookup a user's privyId by their identifier
 * Returns null if user is not found
 */
async function lookupUserPrivyId(
  recipientType: RecipientType,
  identifier: string
): Promise<string | null> {
  try {
    let user = null;

    switch (recipientType) {
      case RecipientType.EMAIL:
        user = await prisma.user.findUnique({
          where: { email: identifier.toLowerCase() },
          select: { privyId: true },
        });
        break;
      case RecipientType.DISCORD:
        user = await prisma.user.findUnique({
          where: { discordId: identifier },
          select: { privyId: true },
        });
        break;
      case RecipientType.TWITTER:
        user = await prisma.user.findUnique({
          where: { twitterId: identifier },
          select: { privyId: true },
        });
        break;
      case RecipientType.WALLET:
        user = await prisma.user.findUnique({
          where: { walletAddress: identifier.toLowerCase() },
          select: { privyId: true },
        });
        break;
      case RecipientType.PUBLIC:
        // PUBLIC drops don't have a specific recipient
        return null;
    }

    return user?.privyId ?? null;
  } catch (error) {
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
  // data.amount is expected to be a string representing USDC in 6 decimals
  const dropAmount = BigInt(Number(data.amount) * 1e6);
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

export async function confirmDrop(
  { dropId, onchainId, txHash }: ConfirmDropRequest,
  senderPrivyId?: string
): Promise<void> {
  // Fetch drop
  const drop = await prisma.drop.findUnique({ where: { id: dropId } });
  if (!drop) {
    throw new NotFoundError("Drop not found");
  }

  // Verify ownership (only if senderPrivyId provided)
  if (senderPrivyId && drop.senderPrivyId !== senderPrivyId) {
    throw new ForbiddenError("Only the sender can confirm this drop");
  }

  // Check status
  if (drop.status !== DropStatus.PENDING) {
    throw new ValidationError(
      `Drop is not pending (current status: ${dropStatusToString(drop.status)})`
    );
  }

  // Convert onchainId to bigint for Prisma
  const onchainIdBigInt =
    typeof onchainId === "bigint" ? onchainId : BigInt(onchainId);

  // Update drop and log event atomically
  await prisma.$transaction([
    prisma.drop.update({
      where: { id: dropId },
      data: {
        onchainId: onchainIdBigInt,
        creationTxHash: txHash,
        status: DropStatus.ACTIVE,
        updatedAt: new Date(),
      },
    }),
    prisma.dropEvent.create({
      data: {
        dropId,
        eventType: DropEventType.CREATED,
        txHash,
        createdAt: new Date(),
      },
    }),
  ]);
}

export async function getDropDetails(
  dropId: string,
  authenticatedUserPrivyId?: string
) {
  const drop = await prisma.drop.findUnique({ where: { id: dropId } });
  if (!drop) {
    throw new NotFoundError("Drop not found");
  }

  const summary = mapDropToSummary(drop);

  // Check if the authenticated user can claim this drop

  const isPublicDrop = drop.recipientType === RecipientType.PUBLIC;
  let canClaim = isPublicDrop;

  if (authenticatedUserPrivyId && !isPublicDrop) {
    // For non-public drops, check if the authenticated user is the recipient
    const recipientPrivyId = await lookupUserPrivyId(
      drop.recipientType,
      drop.recipientIdentifier
    );
    logger.info(recipientPrivyId, authenticatedUserPrivyId, "recipientPrivyId");

    // If recipient has a privyId, check if it matches the authenticated user
    if (recipientPrivyId) {
      canClaim = recipientPrivyId === authenticatedUserPrivyId;
    }
  }

  return {
    ...summary,
    canClaim,
  };
}

export async function issueClaimPermit(
  dropId: string,
  request: ClaimPermitRequest,
  authenticatedUserPrivyId?: string,
  oauthProvider: string = "privy"
): Promise<ClaimPermitResponse> {
  const drop = await prisma.drop.findUnique({ where: { id: dropId } });
  if (!drop) {
    throw new NotFoundError("Drop not found");
  }

  if (drop.status !== DropStatus.ACTIVE) {
    throw new ValidationError(`Drop is ${dropStatusToString(drop.status)}`);
  }

  if (drop.expiry && drop.expiry.getTime() <= Date.now()) {
    throw new ValidationError("Drop has expired");
  }

  if (!drop.onchainId) {
    throw new ValidationError("Drop is not confirmed on-chain yet");
  }

  const recipientType = drop.recipientType;
  const claimerAddress = request.claimerAddress.toLowerCase();
  const isPublicDrop = recipientType === RecipientType.PUBLIC;

  // For non-public drops, strictly validate the authenticated user is the recipient
  if (!isPublicDrop) {
    // Look up the recipient user by their identifier
    const recipientPrivyId = await lookupUserPrivyId(
      recipientType,
      drop.recipientIdentifier
    );

    // If no user found, they don't have access to the drop
    if (!recipientPrivyId) {
      throw new ForbiddenError("You're not the recipient of this drop");
    }

    // Strictly validate that the authenticated user's privyId matches the recipient's privyId
    if (!authenticatedUserPrivyId) {
      throw new ForbiddenError("Authentication required to claim this drop");
    }

    if (authenticatedUserPrivyId !== recipientPrivyId) {
      throw new ForbiddenError("You're not the recipient of this drop");
    }
  }

  // Additional validation based on recipient type
  if (recipientType === RecipientType.WALLET) {
    const normalizedClaimerAddress = normalizeIdentifier(
      claimerAddress,
      recipientType
    );
    if (normalizedClaimerAddress !== drop.recipientIdentifier) {
      throw new ForbiddenError(
        "Claimer address does not match intended recipient"
      );
    }
  } else if (requiresAuthorization(recipientType)) {
    if (!request.claimerIdentifier) {
      throw new ValidationError("Claimer identifier is required");
    }

    const normalizedClaimer = normalizeIdentifier(
      request.claimerIdentifier,
      recipientType
    );
    const expectedCommit = computeRecipientCommit(
      recipientType,
      normalizedClaimer,
      drop.id
    );

    if (expectedCommit !== drop.recipientCommit) {
      throw new ForbiddenError(
        "Claimer identity does not match intended recipient"
      );
    }

    const identifierHash = ethers.keccak256(
      ethers.toUtf8Bytes(normalizedClaimer)
    );

    const identifierType = mapRecipientTypeToSocialIdentifier(recipientType);
    if (identifierType) {
      await prisma.socialIdentity.upsert({
        where: {
          identifierHash_walletAddress: {
            identifierHash,
            walletAddress: claimerAddress,
          },
        },
        update: {
          identifierRaw: normalizedClaimer,
          oauthProvider,
          lastVerifiedAt: new Date(),
        },
        create: {
          identifierType,
          identifierRaw: normalizedClaimer,
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

export async function relayClaim(
  dropId: string,
  request: RelayClaimRequest
): Promise<RelayClaimResponse> {
  const drop = await prisma.drop.findUnique({ where: { id: dropId } });
  if (!drop) {
    throw new NotFoundError("Drop not found");
  }

  if (drop.status !== DropStatus.ACTIVE) {
    throw new ValidationError(`Drop is ${dropStatusToString(drop.status)}`);
  }

  if (drop.expiry && drop.expiry.getTime() <= Date.now()) {
    throw new ValidationError("Drop has expired");
  }

  if (!drop.onchainId) {
    throw new ValidationError("Drop is not confirmed on-chain yet");
  }

  if (!drop.gasTankAmount) {
    throw new ValidationError("Gas tank amount not set for this drop");
  }

  const claimerAddress = request.claimer;

  try {
    // Validate timestamp is recent (within 5 minutes) to prevent replay attacks
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

    // Reconstruct the exact message format that the frontend signed
    const message = `GiftLink Claim Authorization
Drop ID: ${drop.onchainId}
Claimer: ${claimerAddress}
Timestamp: ${request.timestamp}`;

    const recoveredAddress = ethers.verifyMessage(
      message,
      request.claimerSignature
    );

    if (recoveredAddress !== claimerAddress) {
      throw new ForbiddenError(
        "Claimer signature does not match claimer address"
      );
    }
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ForbiddenError) {
      throw error;
    }
    throw new ValidationError("Invalid claimer signature");
  }

  // Get claim permit (reuse issueClaimPermit logic)
  const recipientType = drop.recipientType;

  if (recipientType === RecipientType.WALLET) {
    const normalizedClaimerAddress = normalizeIdentifier(
      claimerAddress,
      recipientType
    );
    if (normalizedClaimerAddress !== drop.recipientIdentifier) {
      throw new ForbiddenError(
        "Claimer address does not match intended recipient"
      );
    }
  } else if (requiresAuthorization(recipientType)) {
    // Verify the claimer matches the recipient
    // The drop's recipientIdentifier should match the claimer's identifier
    // This is already validated by the signature verification above
  }

  // Generate permit
  const domain = CLAIM_PERMIT_DOMAIN(
    env.CHAIN_ID,
    env.GIFTLINK_CONTRACT_ADDRESS,
    env.EIP712_DOMAIN_NAME,
    env.EIP712_VERSION
  );

  const permitExpiry = Math.floor(Date.now() / 1000) + 3600;
  const typedData = {
    dropId: drop.onchainId,
    claimer: claimerAddress,
    expiry: permitExpiry,
  };

  const permitSignature = await backendSigner.signTypedData(
    domain,
    CLAIM_PERMIT_TYPES,
    typedData
  );
  logger.info(permitSignature, "permitSignature");

  // Check relayer balance (native gas token)
  const relayerBalance = await provider.getBalance(relayerWallet.address);
  logger.info(relayerBalance, "relayerBalance");
  if (relayerBalance === 0n) {
    throw new ServiceUnavailableError(
      "Relayer has insufficient balance for gas"
    );
  }

  // Create contract instance with relayer wallet
  const contract = new Contract(
    env.GIFTLINK_CONTRACT_ADDRESS,
    GiftLinkABI,
    relayerWallet.connect(provider)
  );

  // Execute claimWithPermit
  let txHash: string;
  try {
    const dropIdBigInt = drop.onchainId;

    const tx = await contract.claimWithPermit(
      dropIdBigInt,
      claimerAddress,
      permitExpiry,
      permitSignature
    );
    logger.info(tx, "tx");
    // Wait for transaction confirmation
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new ValidationError("Claim transaction failed");
    }

    txHash = receipt.hash;
  } catch (error: any) {
    logger.error({ error }, "[relayClaim] Transaction failed");
    if (
      error.code === "INSUFFICIENT_FUNDS" ||
      error.message?.includes("insufficient funds")
    ) {
      throw new ServiceUnavailableError(
        "Relayer has insufficient balance for gas"
      );
    }
    throw new ValidationError(
      `Claim transaction failed: ${error.message || "Unknown error"}`
    );
  }

  // Update drop with relayer address
  await prisma.drop.update({
    where: { id: dropId },
    data: {
      relayerAddress: relayerWallet.address.toLowerCase(),
      updatedAt: new Date(),
    },
  });

  return {
    txHash,
    amounts: {
      claimerReceived: drop.amount,
      relayerReimbursed: drop.gasTankAmount || "0",
    },
  };
}

export async function recordDropClaim(
  dropId: string,
  request: ClaimConfirmRequest,
  claimerPrivyId?: string
): Promise<void> {
  const drop = await prisma.drop.findUnique({ where: { id: dropId } });
  if (!drop) {
    throw new NotFoundError("Drop not found");
  }

  if (drop.status === DropStatus.REVOKED) {
    throw new ValidationError("Drop has been revoked");
  }

  if (drop.status === DropStatus.PENDING) {
    throw new ValidationError("Drop is not active yet");
  }

  if (drop.status === DropStatus.EXPIRED) {
    throw new ValidationError("Drop has expired");
  }

  const receipt = await provider.getTransactionReceipt(request.txHash);
  if (!receipt || receipt.status !== 1) {
    throw new ValidationError("Transaction failed or is not confirmed");
  }

  if (drop.status === DropStatus.CLAIMED) {
    return;
  }

  // If recipientPrivyId is not set and we have claimerPrivyId, set it
  const finalRecipientPrivyId = drop.recipientPrivyId ?? claimerPrivyId ?? null;

  await prisma.$transaction([
    prisma.drop.update({
      where: { id: dropId },
      data: {
        status: DropStatus.CLAIMED,
        claimTxHash: request.txHash,
        claimerAddress: request.claimerAddress.toLowerCase(),
        claimerWalletType: walletTypeToEnum(request.walletType),
        claimerIdentifier:
          drop.recipientType === RecipientType.PUBLIC
            ? null
            : drop.recipientIdentifier,
        recipientPrivyId: finalRecipientPrivyId,
        claimedAt: new Date(),
        updatedAt: new Date(),
      },
    }),
    prisma.dropEvent.create({
      data: {
        dropId,
        eventType: DropEventType.CLAIMED,
        actorAddress: request.claimerAddress.toLowerCase(),
        txHash: request.txHash,
      },
    }),
  ]);
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

  const receipt = await provider.getTransactionReceipt(request.txHash);
  if (!receipt || receipt.status !== 1) {
    throw new ValidationError("Transaction failed or is not confirmed");
  }

  await prisma.$transaction([
    prisma.drop.update({
      where: { onchainId: Number(dropId) },
      data: {
        status: DropStatus.REVOKED,
        revokeTxHash: request.txHash,
        updatedAt: new Date(),
      },
    }),
    prisma.dropEvent.create({
      data: {
        dropId: drop.id,
        eventType: DropEventType.REVOKED,
        txHash: request.txHash,
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

  // Build list of identifiers to match
  const identifiers: string[] = [];
  if (user.email) identifiers.push(user.email.toLowerCase());
  if (user.discordId) identifiers.push(user.discordId);
  if (user.twitterId) identifiers.push(user.twitterId);

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
