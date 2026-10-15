/**
 * Pure display/format helpers for Nomine amounts and times.
 *
 * Deliberately dependency-free apart from viem's unit conversion: no `import.meta.env`, no ABI, no
 * project aliases. That keeps the rendering rules executable in a plain runtime test, which is how
 * the Intl timestamp bug was caught (`tests/viewHelpers.test.ts`).
 */

import { formatUnits, parseUnits } from "viem";

/** Arc testnet USDC has 6 decimals (spec §1). */
export const USDC_DECIMALS = 6;

export function usdcToBaseUnits(amount: string | number): bigint {
  return parseUnits(String(amount), USDC_DECIMALS);
}

export function formatUsdc(baseUnits: bigint | number | string | null | undefined): string {
  if (baseUnits === null || baseUnits === undefined) return "0";
  try {
    return formatUnits(BigInt(baseUnits), USDC_DECIMALS);
  } catch {
    return String(baseUnits);
  }
}

export function formatUsdcDisplay(
  baseUnits: bigint | number | string | null | undefined
): string {
  return `${formatUsdc(baseUnits)} USDC`;
}

/**
 * A USDC amount with a fixed number of decimals, for labels paired with a rounded total
 * ("2.00 / 5.00 USDC paid").
 *
 * A non-zero amount that would round away to zero is shown exactly instead of as "0.00", so a small
 * settled amount is never reported as nothing.
 */
export function formatUsdcFixed(
  baseUnits: bigint | number | string | null | undefined,
  decimals = 2
): string {
  const exact = formatUsdc(baseUnits);
  const numeric = Number(exact);
  if (!Number.isFinite(numeric)) return exact;
  if (numeric !== 0 && Number(numeric.toFixed(decimals)) === 0) return exact;
  return numeric.toFixed(decimals);
}

/**
 * Format an absolute unix-seconds timestamp, explicitly showing the timezone, so a deadline can
 * never be read as local time by mistake.
 *
 * `dateStyle`/`timeStyle` may **not** be combined with `timeZoneName`: Intl throws a TypeError for
 * that combination, which would break every screen that renders a deadline. Explicit components
 * are the supported way to include the zone name, the numeric offset is appended below so the
 * zone is unambiguous, and a formatter failure must never take the page down with it.
 */
export function formatTimestampWithTimezone(ts?: number | null): string {
  if (ts === null || ts === undefined) return "—";
  const date = new Date(Number(ts) * 1000);
  if (Number.isNaN(date.getTime())) return "—";

  let local: string;
  try {
    local = new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    local = date.toISOString();
  }

  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const offset = `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(
    abs % 60
  ).padStart(2, "0")}`;

  return `${local} (${offset})`;
}

/**
 * Absolute unix-seconds consent deadline, never later than the campaign expiry.
 *
 * The default window is 24 hours: the pilot's issuer approval is a manual step (D-019), so a
 * one-hour window could lapse before the issuer confirms the claimant's wallet. The result is
 * still capped at the campaign expiry, and an explicit window is respected.
 */
export function defaultConsentDeadline(
  expiryTime?: number | null,
  windowSeconds = 86400
): number {
  const now = Math.floor(Date.now() / 1000);
  const proposed = now + windowSeconds;
  if (expiryTime && expiryTime > 0) {
    return Math.min(proposed, expiryTime);
  }
  return proposed;
}
