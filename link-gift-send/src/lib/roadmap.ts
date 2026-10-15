/**
 * The Nomine roadmap: the single source of truth for what is live and what is coming.
 *
 * Honesty rule (`brand/approved/GUIDELINES.md`, "Architecture and voice"): never present an
 * unshipped surface as shipped. `status` is the only scheduling vocabulary - "next" and
 * "later" - and nothing here carries a date, a partner, a user count or an audit claim.
 *
 * Pure data and pure helpers only, so it is importable from a plain `node --test` runtime as
 * well as from the app: no React, no `@/` aliases and no `import.meta`.
 */

/** The only scheduling vocabulary. There are deliberately no dates. */
export type RoadmapStatus = "live" | "next" | "later";

/**
 * A named product surface. An item without a `surface` is product-wide and appears wherever a
 * surface preview is rendered.
 */
export type RoadmapSurface = "studio" | "inbox" | "landing";

export interface RoadmapItem {
  id: string;
  title: string;
  blurb: string;
  status: RoadmapStatus;
  /**
   * The surface this item is specific to. Omitted for product-wide items (for example "More
   * Gates", which belongs to Studio and the Inbox alike), which are shown on every surface.
   */
  surface?: RoadmapSurface;
}

export const roadmap: RoadmapItem[] = [
  // ---- Live: shipped and usable today ----
  {
    id: "email-addressed-usdc",
    title: "Email-addressed USDC",
    blurb: "Send USDC to an email; recipients claim to a wallet with no gas.",
    status: "live",
  },
  {
    id: "gasless-claims",
    title: "Gasless claims",
    blurb: "Nomine sponsors the settlement transaction.",
    status: "live",
  },
  {
    id: "automatic-approval",
    title: "Automatic approval",
    blurb: "Recipients are paid the moment they claim.",
    status: "live",
  },
  {
    id: "issuer-recovery",
    title: "Issuer recovery",
    blurb: "Reclaim unclaimed funds after expiry.",
    status: "live",
  },

  // ---- Next: actively planned, not built ----
  {
    id: "csv-import",
    title: "CSV import",
    blurb: "Upload hundreds of recipients at once.",
    status: "next",
    surface: "studio",
  },
  {
    // Belongs to Studio and the Inbox alike, so it carries no single surface.
    id: "more-gates",
    title: "More Gates",
    blurb: "Address value to a GitHub, X or Discord handle, not just an email.",
    status: "next",
  },
  {
    id: "claim-notifications",
    title: "Claim notifications",
    blurb: "Recipients get an email the moment value is addressed to them.",
    status: "next",
    surface: "inbox",
  },
  {
    id: "campaign-analytics",
    title: "Campaign analytics",
    blurb: "Claim rates, timing and unclaimed balance at a glance.",
    status: "next",
    surface: "studio",
  },

  // ---- Later: considered, with no commitment ----
  {
    id: "recurring-payouts",
    title: "Recurring payouts",
    blurb: "Payroll-style schedules for contributors and grantees.",
    status: "later",
    surface: "studio",
  },
  {
    id: "multi-chain",
    title: "Multi-chain",
    blurb: "Fund on Arc, claim to the chain you use.",
    status: "later",
  },
  {
    id: "public-issuer-profiles",
    title: "Public issuer profiles",
    blurb: "Verified issuer pages recipients can trust.",
    status: "later",
  },
];

/** Every item with the given status, in source order. */
export function itemsByStatus(status: RoadmapStatus): RoadmapItem[] {
  return roadmap.filter((item) => item.status === status);
}

/**
 * The `next` and `later` items to preview on a surface: the items specific to that surface,
 * plus the product-wide ones. `live` items are never previews - they are already shipped.
 */
export function featuresForSurface(surface: RoadmapSurface): RoadmapItem[] {
  return roadmap.filter(
    (item) =>
      item.status !== "live" &&
      (item.surface === undefined || item.surface === surface)
  );
}
