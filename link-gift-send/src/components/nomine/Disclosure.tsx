/**
 * Nomine disclosures + shared fact rows.
 *
 * Honesty copy lives here so every surface states the same thing and never hides it. Keep the
 * wording aligned with `docs/nomine-claim-core-integration.md` §9.
 */

import type { ReactNode } from "react";
import { Info, ShieldAlert } from "lucide-react";
import { explorerAddressUrl, shortenAddress } from "@/lib/claimCore";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Canonical copy
// ---------------------------------------------------------------------------

export const ISSUER_KEY_NOTICE =
  "The issuer-approval key is yours. Nomine never requests, uploads or stores it. Nomine only verifies that the Approval signature recovers to the address you configured.";

export const RECOVERY_RULE =
  "Fixed recovery rule: after the expiry time, any unclaimed USDC returns to the issuer. Recovery needs no approver signature.";

export const NO_REVOCATION_NOTICE =
  "The contract has no revocation. Changing wallet, re-signing, disconnecting or deleting a pending request does not invalidate an already-signed live authorization.";

export const WALLET_CHANGE_NOTICE = `${NO_REVOCATION_NOTICE} You can still choose a different wallet before signing a new authorization, but the previously signed request stays live until it settles or the campaign expires. Do not create conflicting active requests.`;

export const D006_NOTICE =
  "Wallet consent proves control of a wallet, not ownership of an identity. Collusion between the two Gate authorities (issuer approver + Resolver) remains the D-006 risk and is not hidden.";

export const EVIDENCE_NOTICE =
  "Manual issuer confirmation is a real human action through a known channel. The software shows it; it does not prove it.";

export const ELIGIBILITY_NOTICE =
  "Eligibility is a verified email from the identity provider (Privy linked email), normalized server-side. Caller-supplied email, query parameters and UI flags are never proof.";

export const FUNDING_NOTICE =
  "Funding is verifiable on-chain via the canonical CampaignFunded event. \"Funded\" is only shown after the backend confirms that event.";

export const DIRECT_PAYOUT_NOTICE =
  "Payout is a direct USDC transfer to the wallet you sign with. Nomine never holds your funds.";

export const ISSUER_CONFIRMATION_NOTICE =
  "Your consent is held as Awaiting issuer confirmation until the issuer approves it. Nothing settles before that approval.";

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

interface NomineDisclosureProps {
  title?: string;
  children: ReactNode;
  tone?: "info" | "warning";
  className?: string;
}

export function NomineDisclosure({
  title,
  children,
  tone = "info",
  className,
}: NomineDisclosureProps) {
  const Icon = tone === "warning" ? ShieldAlert : Info;
  return (
    <div
      className={cn(
        "rounded-lg border p-4 text-sm",
        tone === "warning"
          ? "border-danger/30 bg-danger/5 text-foreground"
          : "border-border bg-surface/50 text-muted-foreground",
        className
      )}
    >
      {title ? (
        <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
          <Icon className="h-4 w-4" />
          {title}
        </div>
      ) : null}
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

export function NomineFactRow({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 text-sm", className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right", mono && "font-mono")}>{value}</span>
    </div>
  );
}

export function NomineAuthorityRow({
  role,
  address,
  note,
}: {
  role: string;
  address?: string | null;
  note?: string;
}) {
  const url = explorerAddressUrl(address);
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <div>
        <div className="text-muted-foreground">{role}</div>
        {note ? <div className="text-xs text-muted-foreground/80">{note}</div> : null}
      </div>
      <div className="text-right">
        {address ? (
          url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-accent hover:underline"
            >
              {shortenAddress(address, 6)}
            </a>
          ) : (
            <span className="font-mono">{shortenAddress(address, 6)}</span>
          )
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}
