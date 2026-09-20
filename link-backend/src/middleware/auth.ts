import { Request, Response, NextFunction } from "express";
import { UnauthorizedError } from "../utils/errors";
import { syncUserFromPrivy } from "../services/authService";

export interface AuthenticatedUser {
  userId: string;
  privyUserId: string;
  walletAddress: string | null;
  email: string | null;
  discordId: string | null;
  twitterId: string | null;
  telegramId: string | null;
}

export interface AuthRequest extends Request {
  authUser?: AuthenticatedUser;
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
    console.log(idToken, "idToken");

    const user = await syncUserFromPrivy(idToken);

    req.authUser = {
      userId: user.id,
      privyUserId: user.privyId,
      walletAddress: user.walletAddress,
      email: user.email,
      discordId: user.discordId,
      twitterId: user.twitterId,
      telegramId: user.telegramId,
    };

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
 * Attempts to authenticate the user if cookies are present,
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

    // Attempt to authenticate
    const user = await syncUserFromPrivy(idToken);

    req.authUser = {
      userId: user.id,
      privyUserId: user.privyId,
      walletAddress: user.walletAddress,
      email: user.email,
      discordId: user.discordId,
      twitterId: user.twitterId,
      telegramId: user.telegramId,
    };

    next();
  } catch (error) {
    // Silently continue if authentication fails
    // This allows public access while still setting authUser when possible
    next();
  }
}
