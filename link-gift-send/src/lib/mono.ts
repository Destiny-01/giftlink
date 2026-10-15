/**
 * Display-truncation helpers for machine strings (addresses, hashes, digests) and emails.
 *
 * Pure and dependency-free so the truncation rule is executable in a plain runtime test, and so
 * `MonoValue` never has to re-implement it. Truncation is presentation only: callers keep the full
 * value for the `title` attribute and the copy button.
 */

/** Characters kept at the start of a truncated value. */
export const MONO_HEAD = 6;

/** Characters kept at the end of a truncated value. */
export const MONO_TAIL = 4;

/**
 * First 6 and last 4 characters, joined by a single ellipsis. Values that are already short enough
 * to fit are returned unchanged, so a short chain id never gains a misleading ellipsis.
 */
export function truncateMono(
  value: string | null | undefined,
  head = MONO_HEAD,
  tail = MONO_TAIL
): string {
  if (!value) return "";
  if (value.length <= head + tail) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * Mask an email for a signed-out hint: the local part keeps its first character, the domain keeps
 * its first character and its TLD (e.g. "alice@example.com" -> "a***@e***.com"). Never reveals the
 * full address, which is what makes it safe to render before authentication.
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0 || at === email.length - 1) return null;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const domainName = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";

  const maskedLocal = `${local.slice(0, 1)}***`;
  const maskedDomain = `${domainName.slice(0, 1)}***${tld}`;
  return `${maskedLocal}@${maskedDomain}`;
}
