/**
 * Pure helpers for the Studio create form: recipient parsing, the running total, the expiry presets
 * and the exact prepare payload.
 *
 * Kept free of React, `import.meta.env` and project aliases so the parsing and payload rules are
 * executable in a plain runtime test - the payload rule in particular ("omit the approver when
 * automatic approval is on") is a contract with the backend, not a UI detail.
 */

import type { PrepareCampaignRequest } from "../types/nomine";

/**
 * A deliberately permissive check: one `@`, a non-empty local part and a dotted domain. Stricter
 * validation belongs to the backend, which normalizes and re-checks anyway; this only has to catch
 * the obvious typos before a round trip.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

export interface ParsedRecipients {
  /** Valid, de-duplicated addresses in the order they were entered. */
  emails: string[];
  /** Entries that are not usable addresses at all. */
  invalid: string[];
  /** Entries dropped because the same address (case-insensitively) was already listed. */
  duplicates: string[];
}

/**
 * Split a pasted list on newlines, commas and semicolons, then de-duplicate case-insensitively
 * while keeping the first spelling. Duplicates and invalid entries are reported rather than
 * silently dropped, so the form can flag them.
 */
export function parseRecipientEmails(text: string): ParsedRecipients {
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];

  for (const raw of text.split(/[\n,;]+/)) {
    const entry = raw.trim();
    if (!entry) continue;

    if (!isValidEmail(entry)) {
      invalid.push(entry);
      continue;
    }

    const key = entry.toLowerCase();
    if (seen.has(key)) {
      duplicates.push(entry);
      continue;
    }
    seen.add(key);
    emails.push(entry);
  }

  return { emails, invalid, duplicates };
}

/** Total in USDC base units, or null when there is nothing to fund yet. */
export function computeTotalBaseUnits(
  allocationBaseUnits: bigint | null,
  recipientCount: number
): bigint | null {
  if (!allocationBaseUnits || allocationBaseUnits <= 0n) return null;
  if (recipientCount <= 0) return null;
  return allocationBaseUnits * BigInt(recipientCount);
}

export type ExpiryPreset = "24h" | "7d" | "30d" | "custom";

/** Preset windows, in seconds, measured from the opening time. */
export const EXPIRY_PRESET_SECONDS: Record<Exclude<ExpiryPreset, "custom">, number> = {
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
};

export const DEFAULT_EXPIRY_PRESET: ExpiryPreset = "7d";

/** The expiry a preset implies, given the opening time in unix seconds. */
export function presetExpiry(preset: ExpiryPreset, openingTime: number): number {
  if (preset === "custom") return openingTime;
  return openingTime + EXPIRY_PRESET_SECONDS[preset];
}

export interface PrepareFormInput {
  allocationBaseUnits: bigint | null;
  emails: string[];
  openingTime: number;
  expiryTime: number;
  /** "Approve each payout yourself". Off means automatic approval. */
  advanced: boolean;
  /** Only meaningful when `advanced` is on. */
  issuerApproverAddress: string;
}

/**
 * The exact `POST /campaigns/prepare` body.
 *
 * `issuerApproverAddress` is omitted entirely when automatic approval is selected - the backend
 * treats its absence as auto-approval, and sending an empty string would not mean the same thing.
 */
export function buildPreparePayload(input: PrepareFormInput): PrepareCampaignRequest {
  const payload: PrepareCampaignRequest = {
    allocation: (input.allocationBaseUnits ?? 0n).toString(),
    emails: input.emails,
    openingTime: input.openingTime,
    expiryTime: input.expiryTime,
  };

  const approver = input.issuerApproverAddress.trim();
  if (input.advanced && approver) {
    payload.issuerApproverAddress = approver;
  }

  return payload;
}
