import { User } from "@prisma/client";
import { prisma } from "../config/prisma";
import { privyClient } from "../config/privy";
import { UnauthorizedError } from "../utils/errors";
import { UserResponse, AuthResponse } from "../dto/user.dto";
import { logger } from "../config/logger";
import { errorDiagnostics } from "../utils/safeLog";

type PrivyUser = Awaited<ReturnType<(typeof privyClient)["getUser"]>>;
type LinkedAccount = PrivyUser extends { linkedAccounts: infer T }
  ? T extends Array<infer U>
    ? U
    : never
  : never;

/**
 * Verified identity facts for a Privy user, derived from the provider's linked accounts.
 *
 * `walletAddresses` carries every wallet the provider says this user controls, not just
 * the first one. The single `walletAddress` column on `User` cannot represent a second
 * wallet, so authorization decisions must use this list rather than that column.
 *
 * `socialIdentifiers` carries every value the provider reports per social platform. The
 * provider gives both a numeric id and a handle, and the gift form addresses recipients by
 * handle (`@username`, `username#1234`), so matching only the id would refuse correctly
 * authenticated recipients.
 */
export interface PrivyIdentities {
  walletAddresses: string[];
  /** Lower-case address -> provider's own classification of that wallet. */
  walletKinds: Record<string, WalletKind>;
  walletAddress: string | null;
  email: string | null;
  discordId: string | null;
  twitterId: string | null;
  telegramId: string | null;
  socialIdentifiers: SocialIdentifiers;
}

/** Every verified value the provider reports for a social platform. */
export interface SocialIdentifiers {
  discord: string[];
  twitter: string[];
  telegram: string[];
}

/** How the provider classifies a linked wallet. */
export type WalletKind = "privy" | "external";

export async function authenticateWithPrivy(
  authToken: string
): Promise<AuthResponse> {
  const { userId } = await verifyPrivyAuthToken(authToken);
  const { user } = await syncUserFromPrivy(userId);

  logger.info(
    {
      operation: "authenticateWithPrivy",
      outcome: "success",
      userId: user.id,
    },
    "User authenticated"
  );

  return {
    privyUserId: user.privyId,
    user: mapUserToResponse(user),
  };
}

/**
 * Resolves the Privy token to a persisted user and the verified identity attached to it.
 * The persisted user is the workflow record; the identities are what provider data
 * actually says, and they are what authorization decisions must be based on.
 */
export async function syncUserFromPrivy(idToken: string): Promise<{
  user: User;
  identities: PrivyIdentities;
}> {
  const privyUser = await privyClient.getUser({ idToken });

  if (!privyUser) {
    throw new UnauthorizedError("Privy user not found");
  }

  const identities = extractIdentities(privyUser);

  let user: User;
  try {
    user = await prisma.user.upsert({
      where: { privyId: privyUser.id },
      update: {
        walletAddress: identities.walletAddress,
        email: identities.email,
        discordId: identities.discordId,
        twitterId: identities.twitterId,
        telegramId: identities.telegramId,
      },
      create: {
        privyId: privyUser.id,
        walletAddress: identities.walletAddress,
        email: identities.email,
        discordId: identities.discordId,
        twitterId: identities.twitterId,
        telegramId: identities.telegramId,
      },
    });
  } catch (error) {
    logger.error(
      {
        operation: "syncUserFromPrivy",
        outcome: "failure",
        ...errorDiagnostics(error),
      },
      "Failed to persist Privy user"
    );
    throw error;
  }

  return { user, identities };
}

function mapUserToResponse(user: User): UserResponse {
  return {
    id: user.id,
    privyId: user.privyId,
    walletAddress: user.walletAddress,
    email: user.email,
    discordId: user.discordId,
    twitterId: user.twitterId,
    telegramId: user.telegramId,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function verifyPrivyAuthToken(authToken: string) {
  try {
    return await privyClient.verifyAuthToken(authToken);
  } catch (error) {
    throw new UnauthorizedError("Invalid Privy authentication token");
  }
}

/**
 * Collects every verified identity the provider reports for this account.
 *
 * Social handles are kept exactly as the provider returns them. Authorization compares them
 * in a normalized form rather than rewriting them here, so this does not alter stored
 * identity values or introduce alias equivalence.
 */
export function extractIdentities(privyUser: PrivyUser): PrivyIdentities {
  const walletAddresses: string[] = [];
  const walletKinds: Record<string, WalletKind> = {};
  const socialIdentifiers: SocialIdentifiers = {
    discord: [],
    twitter: [],
    telegram: [],
  };
  let email: string | null = null;
  let discordId: string | null = null;
  let twitterId: string | null = null;
  let telegramId: string | null = null;

  const accounts = Array.isArray(privyUser?.linkedAccounts)
    ? (privyUser.linkedAccounts as LinkedAccount[])
    : [];

  for (const account of accounts) {
    switch (account?.type) {
      case "wallet":
        if (accountHasAddress(account) && account.address) {
          const address = account.address.toLowerCase();
          if (!walletAddresses.includes(address)) {
            walletAddresses.push(address);
            walletKinds[address] = walletKindOf(account);
          }
        }
        break;
      case "email":
        if (!email && accountHasAddress(account) && account.address) {
          email = account.address.trim().toLowerCase();
        }
        break;
      case "discord_oauth":
        if (!discordId) {
          discordId = primarySocialIdentifier(account);
        }
        collectSocialCandidates(socialIdentifiers.discord, account);
        break;
      case "twitter_oauth":
        if (!twitterId) {
          twitterId = primarySocialIdentifier(account);
        }
        collectSocialCandidates(socialIdentifiers.twitter, account);
        break;
      case "telegram":
        if (!telegramId) {
          telegramId = primarySocialIdentifier(account);
        }
        collectSocialCandidates(socialIdentifiers.telegram, account);
        break;
      default:
        break;
    }
  }

  return {
    walletAddresses,
    walletKinds,
    walletAddress: walletAddresses[0] ?? null,
    email,
    discordId,
    twitterId,
    telegramId,
    socialIdentifiers,
  };
}

/**
 * The value persisted on `User` for a social platform: the provider's id when it reports
 * one, otherwise the handle. Unchanged from before, so stored identity values are stable.
 */
function primarySocialIdentifier(account: LinkedAccount): string | null {
  if (!accountHasUserId(account)) {
    return null;
  }
  return account.userId ?? account.username ?? null;
}

/**
 * Every verified value the provider reports for one social account.
 *
 * These are all facts about a single verified account - its numeric id, its handle, and the
 * legacy `handle#discriminator` form the gift form also accepts - so collecting them is not
 * alias merging across accounts.
 */
function collectSocialCandidates(
  target: string[],
  account: LinkedAccount
): void {
  const candidate = account as {
    userId?: string | null;
    username?: string | null;
    discriminator?: string | null;
  };

  pushCandidate(target, candidate.userId);
  pushCandidate(target, candidate.username);

  if (
    typeof candidate.username === "string" &&
    typeof candidate.discriminator === "string" &&
    candidate.discriminator
  ) {
    pushCandidate(target, `${candidate.username}#${candidate.discriminator}`);
  }
}

function pushCandidate(target: string[], value: unknown): void {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  if (trimmed && !target.includes(trimmed)) {
    target.push(trimmed);
  }
}

/**
 * Classifies a linked wallet using the provider's own field, so the recorded wallet type
 * comes from verified provider data rather than from a request field.
 */
function walletKindOf(account: LinkedAccount): WalletKind {
  const candidate = account as {
    walletClientType?: string | null;
    connectorType?: string | null;
  };
  return candidate.walletClientType === "privy" ? "privy" : "external";
}

function accountHasAddress(
  account: LinkedAccount
): account is LinkedAccount & { address?: string | null } {
  return account != null && typeof account === "object" && "address" in account;
}

function accountHasUserId(account: LinkedAccount): account is LinkedAccount & {
  userId?: string | null;
  username?: string | null;
} {
  return (
    account != null &&
    typeof account === "object" &&
    ("userId" in account || "username" in account)
  );
}
