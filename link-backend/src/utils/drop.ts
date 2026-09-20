import { DropStatus, RecipientType, WalletType } from "@prisma/client";
import { ethers } from "ethers";
import { env } from "../config/env";

export const RECIPIENT_TYPE_MAP: Record<string, RecipientType> = {
  public: RecipientType.PUBLIC,
  email: RecipientType.EMAIL,
  discord: RecipientType.DISCORD,
  twitter: RecipientType.TWITTER,
  wallet: RecipientType.WALLET,
};

export const RECIPIENT_TYPE_ENUM_TO_CONTRACT: Record<RecipientType, number> = {
  [RecipientType.PUBLIC]: 0,
  [RecipientType.EMAIL]: 1,
  [RecipientType.DISCORD]: 2,
  [RecipientType.TWITTER]: 3,
  [RecipientType.WALLET]: 4,
};

export const WALLET_TYPE_MAP: Record<string, WalletType> = {
  external: WalletType.EXTERNAL,
  privy: WalletType.PRIVY,
};

export function normalizeIdentifier(
  identifier: string,
  type: RecipientType | string
): string {
  if (!identifier) {
    return "";
  }

  const normalizedType =
    typeof type === "string" ? type.toLowerCase() : recipientTypeToString(type);

  if (normalizedType === "wallet") {
    return identifier.trim().toLowerCase();
  }

  return identifier.trim().toLowerCase();
}

export function recipientTypeToEnum(type: string): RecipientType {
  const key = type.toLowerCase();
  const value = RECIPIENT_TYPE_MAP[key];
  if (!value) {
    throw new Error(`Unsupported recipient type: ${type}`);
  }
  return value;
}

export function walletTypeToEnum(type: string): WalletType {
  const key = type.toLowerCase();
  const value = WALLET_TYPE_MAP[key];
  if (!value) {
    throw new Error(`Unsupported wallet type: ${type}`);
  }
  return value;
}

export function recipientTypeToNumber(type: RecipientType): number {
  return RECIPIENT_TYPE_ENUM_TO_CONTRACT[type];
}

export function recipientTypeToString(type: RecipientType): string {
  switch (type) {
    case RecipientType.PUBLIC:
      return "public";
    case RecipientType.EMAIL:
      return "email";
    case RecipientType.DISCORD:
      return "discord";
    case RecipientType.TWITTER:
      return "twitter";
    case RecipientType.WALLET:
      return "wallet";
    default:
      return "unknown";
  }
}

export function walletTypeToString(
  type: WalletType | null | undefined
): string | undefined {
  if (!type) return undefined;
  switch (type) {
    case WalletType.EXTERNAL:
      return "external";
    case WalletType.PRIVY:
      return "privy";
    default:
      return undefined;
  }
}

export function dropStatusToString(status: DropStatus): string {
  switch (status) {
    case DropStatus.PENDING:
      return "pending";
    case DropStatus.ACTIVE:
      return "active";
    case DropStatus.CLAIMED:
      return "claimed";
    case DropStatus.REVOKED:
      return "revoked";
    case DropStatus.EXPIRED:
      return "expired";
    default:
      return "unknown";
  }
}

export function requiresAuthorization(type: RecipientType): boolean {
  return type !== RecipientType.PUBLIC;
}

export function maskIdentifier(
  identifier: string,
  type: RecipientType | string
): string {
  const normalizedType =
    typeof type === "string" ? type.toLowerCase() : recipientTypeToString(type);
  const normalizedIdentifier = identifier ?? "";

  if (normalizedType === "public") {
    return "Anyone with link";
  }

  if (normalizedType === "email") {
    const [local, domain] = normalizedIdentifier.split("@");
    if (!local || !domain) {
      return "***@***";
    }
    return `${local.slice(0, 3)}***@${domain}`;
  }

  if (normalizedType === "wallet") {
    if (normalizedIdentifier.length < 10) {
      return normalizedIdentifier;
    }
    return `${normalizedIdentifier.slice(0, 6)}...${normalizedIdentifier.slice(
      -4
    )}`;
  }

  return `${normalizedIdentifier.slice(0, 3)}***`;
}

export function computeRecipientCommit(
  recipientType: RecipientType,
  normalizedIdentifier: string,
  dropId: string,
  pepper: string = env.SERVER_PEPPER
): string {
  if (recipientType === RecipientType.PUBLIC) {
    return ethers.ZeroHash;
  }

  const identifierHash = ethers.keccak256(
    ethers.toUtf8Bytes(normalizedIdentifier)
  );

  // Normalize pepper to exactly 32 bytes (64 hex chars) for bytes32
  // If pepper is not exactly 32 bytes, hash it to get a consistent 32-byte value
  let pepperBytes32: string;
  try {
    const pepperBytes = ethers.getBytes(pepper);
    if (pepperBytes.length === 32) {
      pepperBytes32 = ethers.hexlify(pepperBytes);
    } else {
      // Hash the pepper to get exactly 32 bytes while preserving entropy
      pepperBytes32 = ethers.keccak256(ethers.toUtf8Bytes(pepper));
    }
  } catch {
    // If parsing fails, hash the raw string
    pepperBytes32 = ethers.keccak256(ethers.toUtf8Bytes(pepper));
  }

  return ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "bytes32", "string"],
      [identifierHash, pepperBytes32, dropId]
    )
  );
}

export function computeKeccak256(input: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(input));
}
