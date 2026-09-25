import { Request, Response, NextFunction } from "express";
import { UnauthorizedError } from "../utils/errors";
import {
  syncUserFromPrivy,
  type SocialIdentifiers,
  type WalletKind,
} from "../services/authService";

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
  /**
   * Every verified value the provider reports per social platform, so a gift addressed with
   * a handle can be matched as well as one addressed with the provider's numeric id.
   */
  socialIdentifiers: SocialIdentifiers;
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
    socialIdentifiers: identities.socialIdentifiers,
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
 * Optional authentication middleware: sets `req.authUser` when a token is present and valid,
 * and lets the request continue without one.
 *
 * The relay payout path uses this rather than `authenticate`, because wallet-targeted and
 * public gifts are authorized by proof of wallet control and need no account identity
 * (issue #7: preserve existing access where it does not bypass recipient authorization).
 * The recipient policy still requires an authenticated, verified identity wherever the gift
 * is identity-targeted.
 *
 * @param rejectInvalidToken when true, a token that is present but invalid produces 401
 *   instead of silently continuing as an anonymous caller. Mutating routes want this: a
 *   signed-in caller whose session expired should be told to sign in again rather than be
 *   answered as a stranger by the recipient policy. It is left false for read-only routes,
 *   where an expired session shouldn't stop the page from rendering.
 */
export function optionalAuthenticate(
  options: { rejectInvalidToken?: boolean } = {}
) {
  return async function optionalAuth(
    req: AuthRequest,
    _res: Response,
    next: NextFunction
  ): Promise<void> {
    if (req.method === "OPTIONS") {
      // CORS preflight carries no credentials.
      return next();
    }

    const idToken = req.headers.authorization?.split(" ")[1];
    if (!idToken) {
      return next();
    }

    if (options.rejectInvalidToken) {
      return authenticate(req, _res, next);
    }

    try {
      const { user, identities } = await syncUserFromPrivy(idToken);
      req.authUser = toAuthenticatedUser(user, identities);
    } catch {
      // Read-only route: continue anonymously and let the caller see the public view.
    }

    next();
  };
}
