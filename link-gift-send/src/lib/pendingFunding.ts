/**
 * The funding transaction for a prepared campaign.
 *
 * `createCampaign` escrows real money on-chain. If receipt polling or the backend confirmation
 * fails - or the browser is simply closed - the transaction still exists, so the draft must
 * remember its hash and reconcile it before anything creates a second campaign for the same
 * roster. The roster is immutable, so a second `createCampaign` would escrow a second campaign
 * that the draft can never bind, leaving that allocation reachable only by a manual reclaim.
 *
 * Stored per campaign id in localStorage. Never contains a key, a signature or an identity.
 */

export interface PendingFunding {
  campaignId: string;
  txHash: string;
  startedAt: string;
}

const STORAGE_KEY = "nomine:pending-funding";

function readAll(): Record<string, PendingFunding> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, PendingFunding>;
  } catch {
    // Storage unavailable (private mode, disabled, corrupt): treat as nothing pending. The
    // worst case is the pre-existing behaviour, never a crash.
    return {};
  }
}

function writeAll(entries: Record<string, PendingFunding>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Best effort only.
  }
}

export function readPendingFunding(campaignId: string): PendingFunding | null {
  const entry = readAll()[campaignId];
  if (!entry || typeof entry.txHash !== "string" || !entry.txHash) return null;
  return entry;
}

export function recordPendingFunding(entry: PendingFunding): void {
  writeAll({ ...readAll(), [entry.campaignId]: entry });
}

export function clearPendingFunding(campaignId: string): void {
  const entries = readAll();
  if (!(campaignId in entries)) return;
  delete entries[campaignId];
  writeAll(entries);
}
