import type { Drop } from "@prisma/client";
import { RecipientType } from "@prisma/client";
import {
  computeRecipientCommit,
  normalizeIdentifier,
  recipientTypeToString,
} from "../utils/drop";
import { ForbiddenError } from "../utils/errors";
import type { AuthenticatedUser } from "../middleware/auth";

/**
 * Every backend path that can issue a claim authorization or trigger a payout must go
 * through this module. The relay endpoint is the one that moves USDC and the permit
 * endpoint is the alternative, so both enforce the same recipient policy; the only
 * difference between them is how wallet control is evidenced.
 */
export type WalletEvidence =
  /** The caller signed a challenge with the payout address (relay path). */
  | "signature"
  /** No signature is available, so the payout address must be linked to the account. */
  | "privy-linked";

export interface ClaimAuthorizationInput {
  drop: Pick<
    Drop,
    "id" | "recipientType" | "recipientIdentifier" | "recipientCommit"
  >;
  authUser?: AuthenticatedUser;
  payoutAddress: string;
  walletEvidence: WalletEvidence;
}

export interface ClaimAuthorizationResult {
  /** The verified identity value that matched, for identity-targeted gifts. */
  matchedIdentity: string | null;
}

const NOT_RECIPIENT_MESSAGE =
  "This gift is addressed to a different recipient";
const NOT_LINKED_MESSAGE =
  "The payout wallet is not linked to your account. Connect or link that wallet, then try again.";

/**
 * Resolves the value the provider actually verified for this recipient type.
 * Returns null when the authenticated account has no verified identifier of that kind.
 *
 * Callers must never accept a caller-supplied identifier in place of this.
 */
export function verifiedIdentifierFor(
  authUser: AuthenticatedUser,
  recipientType: RecipientType
): string | null {
  switch (recipientType) {
    case RecipientType.EMAIL:
      return authUser.email ?? null;
    case RecipientType.DISCORD:
      return authUser.discordId ?? null;
    case RecipientType.TWITTER:
      return authUser.twitterId ?? null;
    default:
      return null;
  }
}

/**
 * Enforces the gift's recipient policy before any signature is produced or any gas is
 * spent. Denial messages are deliberately generic: they must not reveal another
 * person's identifier, nor confirm whether a given identifier is the intended one.
 */
export function assertClaimAuthorized({
  drop,
  authUser,
  payoutAddress,
  walletEvidence,
}: ClaimAuthorizationInput): ClaimAuthorizationResult {
  if (!authUser?.privyUserId) {
    throw new ForbiddenError("Authentication is required to claim this gift");
  }

  const recipientType = drop.recipientType;
  const payout = normalizeIdentifier(payoutAddress, RecipientType.WALLET);

  // Public gifts keep first-claim-wins semantics. The caller must still be a real
  // account, and their control of the payout address is evidenced by the signature or
  // by the wallet being linked to that account.
  if (recipientType === RecipientType.PUBLIC) {
    if (walletEvidence === "privy-linked") {
      assertLinkedWallet(authUser, payout);
    }
    return { matchedIdentity: null };
  }

  // Wallet-targeted gifts pay the address the sender chose. The signature proves the
  // caller controls that address, so matching the address is the whole policy there.
  if (recipientType === RecipientType.WALLET) {
    if (normalizeIdentifier(drop.recipientIdentifier, recipientType) !== payout) {
      throw new ForbiddenError(NOT_RECIPIENT_MESSAGE);
    }
    if (walletEvidence === "privy-linked") {
      assertLinkedWallet(authUser, payout);
    }
    return { matchedIdentity: null };
  }

  // Identity-targeted gifts: the recipient comes from verified provider data, and the
  // stored commitment is recomputed from that same identity so the database and the
  // on-chain commitment cannot disagree about who may claim.
  const verifiedIdentifier = verifiedIdentifierFor(authUser, recipientType);

  if (!verifiedIdentifier) {
    throw new ForbiddenError(
      `Sign in with the ${recipientTypeToString(
        recipientType
      )} account this gift was addressed to`
    );
  }

  const normalizedVerified = normalizeIdentifier(
    verifiedIdentifier,
    recipientType
  );

  if (
    normalizedVerified !==
    normalizeIdentifier(drop.recipientIdentifier, recipientType)
  ) {
    throw new ForbiddenError(NOT_RECIPIENT_MESSAGE);
  }

  const expectedCommit = computeRecipientCommit(
    recipientType,
    normalizedVerified,
    drop.id
  );

  if (expectedCommit !== drop.recipientCommit) {
    throw new ForbiddenError(NOT_RECIPIENT_MESSAGE);
  }

  assertLinkedWallet(authUser, payout);

  return { matchedIdentity: normalizedVerified };
}

/**
 * A payout address is authorized when the provider reports it as a wallet this account
 * controls. All linked wallets count, not only the first one.
 */
export function assertLinkedWallet(
  authUser: AuthenticatedUser,
  payoutAddress: string
): void {
  const payout = payoutAddress.toLowerCase();
  const linked = authUser.walletAddresses.map((address) =>
    address.toLowerCase()
  );

  if (!linked.includes(payout)) {
    throw new ForbiddenError(NOT_LINKED_MESSAGE);
  }
}

/**
 * Whether this gift is addressed to the authenticated user.
 *
 * Presentation only: `getDropDetails` uses it so the UI cannot advertise a claim as
 * available to someone the enforcement path would refuse. It deliberately mirrors the
 * permit path's evidence (a linked wallet), which is the stricter of the two paths.
 */
export function isAddressedToUser(
  drop: Pick<Drop, "id" | "recipientType" | "recipientIdentifier" | "recipientCommit">,
  authUser?: AuthenticatedUser
): boolean {
  if (!authUser?.privyUserId) {
    return drop.recipientType === RecipientType.PUBLIC;
  }

  if (drop.recipientType === RecipientType.PUBLIC) {
    return true;
  }

  if (drop.recipientType === RecipientType.WALLET) {
    const target = normalizeIdentifier(
      drop.recipientIdentifier,
      drop.recipientType
    );
    return authUser.walletAddresses.some(
      (address) => address.toLowerCase() === target
    );
  }

  const verifiedIdentifier = verifiedIdentifierFor(authUser, drop.recipientType);
  if (!verifiedIdentifier) {
    return false;
  }

  const normalizedVerified = normalizeIdentifier(
    verifiedIdentifier,
    drop.recipientType
  );
  if (
    normalizedVerified !==
    normalizeIdentifier(drop.recipientIdentifier, drop.recipientType)
  ) {
    return false;
  }

  return (
    computeRecipientCommit(
      drop.recipientType,
      normalizedVerified,
      drop.id
    ) === drop.recipientCommit
  );
}
