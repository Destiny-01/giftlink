import type { Drop } from "@prisma/client";
import { RecipientType } from "@prisma/client";
import {
  computeRecipientCommit,
  normalizeIdentifier,
} from "../utils/drop";
import { ForbiddenError, UnauthorizedError } from "../utils/errors";
import type { AuthenticatedUser } from "../middleware/auth";

/**
 * Every backend path that can issue a claim authorization or trigger a payout must go
 * through this module. The relay endpoint is the one that moves USDC and the permit
 * endpoint is the alternative, so both enforce the same recipient policy; the only
 * difference between them is how wallet control is evidenced.
 *
 * Identity is always taken from the provider's verified linked accounts. A caller-supplied
 * identifier proves nothing and is never accepted in place of one.
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
  /** The verified provider value that matched, for identity-targeted gifts. */
  matchedIdentity: string | null;
}

const NOT_RECIPIENT_MESSAGE =
  "This gift is addressed to a different recipient";
const NOT_LINKED_MESSAGE =
  "The payout wallet is not linked to your account. Connect or link that wallet, then try again.";
const IDENTITY_REQUIRED_MESSAGE =
  "Sign in as the recipient of this gift to claim it";

const DISCRIMINATOR = "#";

/**
 * The comparison form of an identifier.
 *
 * The gift form accepts handles (`@username`, `username#1234`) while the provider reports
 * its own numeric id alongside the handle, so two values for the same account are rarely
 * byte-identical. Stored identities are never rewritten: this only affects comparison.
 */
function comparableIdentifier(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "");
}

function hasDiscriminator(value: string): boolean {
  return value.includes(DISCRIMINATOR);
}

function baseUsername(value: string): string {
  return value.split(DISCRIMINATOR)[0];
}

/**
 * Whether a stored recipient identifier names the account the provider verified.
 *
 * Handles compare after normalisation. A legacy `name#1234` stored identifier is matched on
 * its base name only when exactly one side carries a discriminator - that is, when the
 * provider does not itself know the discriminator the sender typed. When both sides carry
 * one they must agree, so two accounts sharing a username are not conflated.
 */
export function identifiersMatch(
  stored: string,
  verified: string,
  recipientType: RecipientType
): boolean {
  const storedComparable = comparableIdentifier(stored);
  const verifiedComparable = comparableIdentifier(verified);

  if (storedComparable === verifiedComparable) {
    return true;
  }

  if (recipientType !== RecipientType.DISCORD) {
    return false;
  }

  return (
    baseUsername(storedComparable) === baseUsername(verifiedComparable) &&
    hasDiscriminator(storedComparable) !== hasDiscriminator(verifiedComparable)
  );
}

/**
 * Every verified value the provider reports for this recipient type.
 *
 * The provider gives both an id and a handle for a social account. Both are facts about the
 * same verified account, so matching either supports the formats the gift form accepts
 * without merging identifiers across accounts.
 */
export function verifiedCandidatesFor(
  authUser: AuthenticatedUser,
  recipientType: RecipientType
): string[] {
  switch (recipientType) {
    case RecipientType.EMAIL:
      return authUser.email ? [authUser.email] : [];
    case RecipientType.DISCORD:
      return authUser.socialIdentifiers?.discord ??
        (authUser.discordId ? [authUser.discordId] : []);
    case RecipientType.TWITTER:
      return authUser.socialIdentifiers?.twitter ??
        (authUser.twitterId ? [authUser.twitterId] : []);
    default:
      return [];
  }
}

/**
 * The first verified value that matches, or null.
 *
 * Also used by `getDropDetails` so the UI cannot advertise a claim to someone the
 * enforcement path would refuse.
 */
export function matchVerifiedIdentity(
  drop: Pick<Drop, "recipientIdentifier" | "recipientType">,
  authUser: AuthenticatedUser
): string | null {
  const candidates = verifiedCandidatesFor(authUser, drop.recipientType);
  return (
    candidates.find((candidate) =>
      identifiersMatch(
        drop.recipientIdentifier,
        candidate,
        drop.recipientType
      )
    ) ?? null
  );
}

/**
 * The account an authorization decision needs, or 401.
 *
 * 401 rather than 403 on purpose: "sign in" and "you are not the recipient" are different
 * answers, and only the second tells a stranger anything about the gift.
 */
function requireAuthUser(authUser?: AuthenticatedUser): AuthenticatedUser {
  if (!authUser?.privyUserId) {
    throw new UnauthorizedError(IDENTITY_REQUIRED_MESSAGE);
  }
  return authUser;
}

/**
 * The committed identifier must be the one stored beside it.
 *
 * The chain was funded against this commitment, so a row whose identifier was edited
 * without its commitment would otherwise authorize someone the sender never addressed.
 * Checked first, for every recipient type, because it validates the record itself.
 */
function assertStoredCommitMatches(
  drop: Pick<Drop, "id" | "recipientType" | "recipientIdentifier" | "recipientCommit">
): void {
  const expected = computeRecipientCommit(
    drop.recipientType,
    normalizeIdentifier(drop.recipientIdentifier, drop.recipientType),
    drop.id
  );

  if (expected !== drop.recipientCommit) {
    throw new ForbiddenError(NOT_RECIPIENT_MESSAGE);
  }
}

/**
 * Enforces the gift's recipient policy before any signature is produced or any gas is
 * spent. Denial messages are deliberately generic: they must not reveal another person's
 * identifier, nor confirm whether a given identifier is the intended one.
 *
 * An authenticated account is required where the policy needs an identity to check, and
 * where the payout wallet has to be evidenced by a linked account. Wallet-targeted and
 * public gifts keep working on the proven wallet-control signature alone, because neither
 * needs to know who the caller is.
 */
export function assertClaimAuthorized({
  drop,
  authUser,
  payoutAddress,
  walletEvidence,
}: ClaimAuthorizationInput): ClaimAuthorizationResult {
  const recipientType = drop.recipientType;
  const payout = normalizeIdentifier(payoutAddress, RecipientType.WALLET);

  assertStoredCommitMatches(drop);

  // Public gifts keep first-claim-wins semantics. Any authenticated caller may claim, and
  // their control of the payout address is evidenced by the signature or by a linked wallet.
  if (recipientType === RecipientType.PUBLIC) {
    if (walletEvidence === "privy-linked") {
      assertLinkedWallet(requireAuthUser(authUser), payout);
    }
    return { matchedIdentity: null };
  }

  // Wallet-targeted gifts pay the address the sender chose. The signature proves the caller
  // controls that address, so matching it is the whole policy on the relay path.
  if (recipientType === RecipientType.WALLET) {
    if (
      !identifiersMatch(drop.recipientIdentifier, payout, recipientType)
    ) {
      throw new ForbiddenError(NOT_RECIPIENT_MESSAGE);
    }
    if (walletEvidence === "privy-linked") {
      assertLinkedWallet(requireAuthUser(authUser), payout);
    }
    return { matchedIdentity: null };
  }

  // Identity-targeted gifts: the recipient is a verified provider identity, and the payout
  // wallet must belong to that same account.
  const identity = requireAuthUser(authUser);
  const matchedIdentity = matchVerifiedIdentity(drop, identity);

  if (!matchedIdentity) {
    throw new ForbiddenError(NOT_RECIPIENT_MESSAGE);
  }

  assertLinkedWallet(identity, payout);

  return { matchedIdentity };
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
 * available to someone the enforcement path would refuse. It mirrors the permit path's
 * evidence (a linked wallet), which is the stricter of the two paths.
 */
export function isAddressedToUser(
  drop: Pick<Drop, "id" | "recipientType" | "recipientIdentifier" | "recipientCommit">,
  authUser?: AuthenticatedUser
): boolean {
  if (drop.recipientType === RecipientType.PUBLIC) {
    return true;
  }

  if (!authUser?.privyUserId) {
    return false;
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

  if (!matchVerifiedIdentity(drop, authUser)) {
    return false;
  }

  const expected = computeRecipientCommit(
    drop.recipientType,
    normalizeIdentifier(drop.recipientIdentifier, drop.recipientType),
    drop.id
  );

  return expected === drop.recipientCommit;
}
