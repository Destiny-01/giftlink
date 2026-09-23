import { Request, Response, NextFunction } from "express";
import { UnauthorizedError } from "../utils/errors";
import { syncUserFromPrivy, type WalletKind } from "../services/authService";

export interface AuthenticatedUser {
  userId: string;
  privyUserId: string;
  /**
   * Every wallet the identity provider reports for this account. Authorization must use
   * this list, not the single persisted column, so a second or connected wallet is not
   * silently refused.
   */
  walletAddresses: string[];
  /** Lower-case address -> provider's classification, for recording the wallet type. */
  walletKinds: Record<string, WalletKind>;
  /** First linked wallet, persisted on the user record. Kept for compatibility. */
  walletAddress: string | null;
  email: string | null;
  discordId: string | null;
  twitterId: string | null;
  telegramId: string | null;
}

export interface AuthRequest extends Request {
  authUser?: AuthenticatedUser;
}

function toAuthenticatedUser(
  user: Awaited<ReturnType<typeof syncUserFromPrivy>>["user"],
  identities: Awaited<ReturnType<typeof syncUserFromPrivy>>["identities"]
): AuthenticatedUser {
  return {
    userId: user.id,
    privyUserId: user.privyId,
    walletAddresses: identities.walletAddresses,
    walletKinds: identities.walletKinds,
    walletAddress: user.walletAddress,
    email: identities.email,
    discordId: identities.discordId,
    twitterId: identities.twitterId,
    telegramId: identities.telegramId,
  };
}

export async function authenticate(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authToken = req.headers.authorization;
    const idToken = authToken?.split(" ")[1];
    if (!idToken) {
      throw new UnauthorizedError("Missing or invalid authorization header");
    }

    const { user, identities } = await syncUserFromPrivy(idToken);
    req.authUser = toAuthenticatedUser(user, identities);

    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      next(error);
    } else {
      next(new UnauthorizedError("Invalid or expired token"));
    }
  }
}

/**
 * Optional authentication middleware.
 * Attempts to authenticate the user if a token is present,
 * but allows the request to continue even if authentication fails or is missing.
 * Sets req.authUser if authentication succeeds.
 */
export async function optionalAuthenticate(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Skip OPTIONS requests (CORS preflight)
    if (req.method === "OPTIONS") {
      return next();
    }

    const authToken = req.headers.authorization;
    const idToken = authToken?.split(" ")[1];
    if (!idToken) {
      // No token present, continue without authentication
      return next();
    }

    const { user, identities } = await syncUserFromPrivy(idToken);
    req.authUser = toAuthenticatedUser(user, identities);

    next();
  } catch (error) {
    // Silently continue if authentication fails
    // This allows public access while still setting authUser when possible
    next();
  }
}
