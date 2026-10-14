import { parseUnits } from "ethers";
import { env } from "../config/env";
import { ForbiddenError, ValidationError } from "../utils/errors";

/** USDC base units, matching the token and the contract (`docs/nomine-claim-core-integration.md`). */
const USDC_DECIMALS = 6;

/**
 * Studio guardrails: the invite gate and the per-campaign caps.
 *
 * Both are configuration-driven and enforced in the service layer, so the same rules apply
 * however a campaign is prepared. An empty allowlist or an absent cap means "no limit" -
 * the testnet default - while mainnet requires all three by configuration (see
 * `config/env.ts`).
 */

/** Whether Studio is gated by an issuer allowlist. */
export function studioInviteOnly(): boolean {
  return env.ISSUER_ALLOWLIST.length > 0;
}

/** Whether this Privy user may use Studio. An empty allowlist admits everyone. */
export function isIssuerAllowlisted(privyUserId: string): boolean {
  return (
    env.ISSUER_ALLOWLIST.length === 0 ||
    env.ISSUER_ALLOWLIST.includes(privyUserId)
  );
}

/** Refuses an issuer who is not on a non-empty allowlist. */
export function assertIssuerAllowlisted(privyUserId: string): void {
  if (!isIssuerAllowlisted(privyUserId)) {
    throw new ForbiddenError(
      "Studio is invite-only during the pilot.",
      "issuer_not_allowlisted"
    );
  }
}

/**
 * Enforces the per-campaign caps after the roster has been deduplicated.
 *
 * `allocation` is in USDC base units (as the prepare payload carries it), so the budget is
 * `allocation × recipients`, compared against the configured ceiling converted to base units
 * with BigInt. A campaign exactly at a limit passes; only exceeding it is refused.
 */
export function assertCampaignWithinLimits(
  recipientCount: number,
  allocation: string
): void {
  const maxRecipients = env.MAX_CAMPAIGN_RECIPIENTS;
  if (maxRecipients !== undefined && recipientCount > maxRecipients) {
    throw new ValidationError(
      `This campaign has ${recipientCount} recipients, over the configured limit of ${maxRecipients}.`,
      "campaign_cap_exceeded"
    );
  }

  const maxBudgetUsdc = env.MAX_CAMPAIGN_BUDGET_USDC;
  if (maxBudgetUsdc !== undefined) {
    const budget = BigInt(allocation) * BigInt(recipientCount);
    const limit = parseUnits(maxBudgetUsdc, USDC_DECIMALS);
    if (budget > limit) {
      throw new ValidationError(
        `This campaign's budget of ${budget.toString()} USDC base units exceeds the configured limit of ${maxBudgetUsdc} USDC.`,
        "campaign_cap_exceeded"
      );
    }
  }
}
