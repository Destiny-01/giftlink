import { User } from "@prisma/client";
import { prisma } from "../config/prisma";
import { privyClient } from "../config/privy";
import { UnauthorizedError } from "../utils/errors";
import { UserResponse, AuthResponse } from "../dto/user.dto";
import { logger } from "../config/logger";

type PrivyUser = Awaited<ReturnType<(typeof privyClient)["getUser"]>>;
type LinkedAccount = PrivyUser extends { linkedAccounts: infer T }
  ? T extends Array<infer U>
    ? U
    : never
  : never;

export async function authenticateWithPrivy(
  authToken: string
): Promise<AuthResponse> {
  const { userId } = await verifyPrivyAuthToken(authToken);
  const user = await syncUserFromPrivy(userId);
  logger.info(user, "Authenticated user");

  return {
    privyUserId: user.privyId,
    user: mapUserToResponse(user),
  };
}

export async function syncUserFromPrivy(privyUserId: string): Promise<User> {
  try {
    const privyUser = await privyClient.getUser({ idToken: privyUserId });

    if (!privyUser) {
      throw new UnauthorizedError("Privy user not found");
    }

    const identity = extractIdentities(privyUser);
    return prisma.user.upsert({
      where: { privyId: privyUser.id },
      update: {
        walletAddress: identity.walletAddress,
        email: identity.email,
        discordId: identity.discordId,
        twitterId: identity.twitterId,
        telegramId: identity.telegramId,
      },
      create: {
        privyId: privyUser.id,
        walletAddress: identity.walletAddress,
        email: identity.email,
        discordId: identity.discordId,
        twitterId: identity.twitterId,
        telegramId: identity.telegramId,
      },
    });
  } catch (error) {
    logger.error(`Error syncing user from Privy: ${error}`);
    throw error;
  }
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

function extractIdentities(privyUser: PrivyUser) {
  let walletAddress: string | null = null;
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
        if (!walletAddress && accountHasAddress(account)) {
          walletAddress = account.address
            ? account.address.toLowerCase()
            : null;
        }
        break;
      case "email":
        if (!email && accountHasAddress(account)) {
          email = account.address ?? null;
        }
        break;
      case "discord_oauth":
        if (!discordId) {
          discordId = accountHasUserId(account)
            ? account.userId ?? account.username ?? null
            : null;
        }
        break;
      case "twitter_oauth":
        if (!twitterId) {
          twitterId = accountHasUserId(account)
            ? account.userId ?? account.username ?? null
            : null;
        }
        break;
      case "telegram":
        if (!telegramId) {
          telegramId = accountHasUserId(account)
            ? account.userId ?? account.username ?? null
            : null;
        }
        break;
      default:
        break;
    }
  }

  return { walletAddress, email, discordId, twitterId, telegramId };
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
