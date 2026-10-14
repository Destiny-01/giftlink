/**
 * Post-authentication redirect target.
 *
 * `?next=` is attacker-controllable through a shared link, so it is only honoured when it is a
 * same-origin relative path: it must start with a single `/`. An absolute URL, a protocol-relative
 * `//host`, a `javascript:` URL, an empty string, or anything else falls back to the Inbox.
 *
 * Pure and dependency-free so the guard is executable in a plain runtime test.
 */

export const DEFAULT_NEXT_PATH = "/inbox";

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_NEXT_PATH;
  // Same-origin relative paths only: a leading "/" rules out absolute and scheme URLs, and the
  // second check rules out protocol-relative "//host" (and the backslash variant browsers treat
  // the same way).
  if (!raw.startsWith("/")) return DEFAULT_NEXT_PATH;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return DEFAULT_NEXT_PATH;
  return raw;
}
