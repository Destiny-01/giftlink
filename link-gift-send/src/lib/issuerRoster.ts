/**
 * The issuer's own copy of the recipient-to-entitlement mapping.
 *
 * Nomine stores only a salted hash of each address, so it cannot tell the issuer who an approval
 * request belongs to - and it must not be the issuer's only source of truth for that, because the
 * independent check is the whole point of the second attestation. The issuer therefore keeps this
 * record itself, in the browser and as a downloadable file, and approves a wallet assignment only
 * after matching it against a channel it already trusts.
 *
 * Held locally, never sent back to Nomine. Contains addresses the issuer supplied, nothing else.
 */

export interface RosterEntry {
  entitlementId: string;
  email: string;
}

const STORAGE_KEY = "nomine:issuer-roster";

type RosterStore = Record<string, RosterEntry[]>;

function readAll(): RosterStore {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as RosterStore;
  } catch {
    return {};
  }
}

function writeAll(store: RosterStore): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Best effort only: the download is the durable copy.
  }
}

export function saveRoster(campaignId: string, entries: RosterEntry[]): void {
  if (!entries?.length) return;
  writeAll({ ...readAll(), [campaignId]: entries });
}

export function loadRoster(campaignId: string): RosterEntry[] {
  const entries = readAll()[campaignId];
  return Array.isArray(entries) ? entries : [];
}

/** The address the issuer recorded for an identifier, if this browser still holds it. */
export function rosterEmailFor(campaignId: string, entitlementId: string): string | null {
  const target = entitlementId.toLowerCase();
  const entry = loadRoster(campaignId).find(
    (item) => item.entitlementId.toLowerCase() === target
  );
  return entry?.email ?? null;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function rosterCsv(entries: RosterEntry[]): string {
  const rows = entries.map(
    (entry) => `${csvCell(entry.entitlementId)},${csvCell(entry.email)}`
  );
  return ["entitlement_id,email", ...rows].join("\n");
}

/** Download the mapping so it survives clearing this browser. */
export function downloadRoster(campaignId: string, entries: RosterEntry[]): void {
  try {
    const blob = new Blob([rosterCsv(entries)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nomine-recipients-${campaignId}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  } catch {
    // A blocked download must not break the flow: the browser copy is still retained.
  }
}
