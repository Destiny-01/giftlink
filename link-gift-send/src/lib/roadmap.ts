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
    id: "funded-claims",
    title: "Funded Claims on Arc",
    blurb:
      "Capital is escrowed in an immutable contract before a Claim is shown. It settles once or returns to the issuer.",
    status: "live",
  },
  {
    id: "economic-inbox",
    title: "Economic inbox",
    blurb: "Every funded Claim addressed to you, in one place, settled to the wallet you choose.",
    status: "live",
  },
  {
    id: "verified-email-gate",
    title: "Verified-email Gate",
    blurb: "The first Gate: eligibility from a verified email, attested by a named Resolver.",
    status: "live",
  },
  {
    id: "gasless-claims",
    title: "Gasless settlement",
    blurb: "Nomine sponsors the settlement transaction. Claimants never need a gas token.",
    status: "live",
  },
  {
    id: "automatic-approval",
    title: "One-click settlement",
    blurb: "With automatic approval, a qualifying claimant settles in a single click.",
    status: "live",
  },
  {
    id: "issuer-recovery",
    title: "Issuer recovery",
    blurb: "Unused value returns to the issuer after expiry, under rules fixed at funding.",
    status: "live",
  },

  // ---- Next: actively planned, not built ----
  {
    // Belongs to Studio and the Inbox alike, so it carries no single surface.
    id: "more-gates",
    title: "More Gates",
    blurb: "Onchain holdings and roles, GitHub, X and Discord as eligibility sources.",
    status: "next",
  },
  {
    id: "claims-api",
    title: "Claims API and embeds",
    blurb: "Create, fund and settle Claims from inside your own product.",
    status: "next",
    surface: "studio",
  },
  {
    id: "csv-import",
    title: "CSV import",
    blurb: "Address a Claim program to thousands of recipients at once.",
    status: "next",
    surface: "studio",
  },
  {
    id: "claim-notifications",
    title: "Claim notifications",
    blurb: "Know the moment value is addressed to you.",
    status: "next",
    surface: "inbox",
  },
  {
    id: "campaign-analytics",
    title: "Program analytics",
    blurb: "Claim rates, timing and unused balance at a glance.",
    status: "next",
    surface: "studio",
  },

  // ---- Later: considered, with no commitment ----
  {
    id: "milestone-claims",
    title: "Milestone and recurring Claims",
    blurb: "Grants that release across approved milestones, and recurring contributor allocations.",
    status: "later",
    surface: "studio",
  },
  {
    id: "agent-claims",
    title: "Agent and machine Claims",
    blurb: "Value released to an agent or service once its work is verified.",
    status: "later",
  },
  {
    id: "settlement-outcomes",
    title: "Richer settlement outcomes",
    blurb: "Settle into more than a transfer, such as a sponsored onchain position.",
    status: "later",
  },
  {
    id: "private-eligibility",
    title: "Private eligibility proofs",
    blurb: "Prove you qualify without revealing who you are.",
    status: "later",
    surface: "inbox",
  },
  {
    id: "multi-chain",
    title: "Multi-chain",
    blurb: "Fund on Arc, settle to the chain you use.",
    status: "later",
  },
  {
    id: "public-issuer-profiles",
    title: "Public issuer profiles",
    blurb: "Verified issuer pages claimants can trust.",
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
