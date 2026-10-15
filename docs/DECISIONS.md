# Durable Decisions

This document records product and technical decisions that are already settled. It intentionally excludes proposals, future feature ideas, delivery plans, and choices that remain open.

## D-001 — The product is a Claim Layer with an economic inbox

Gift delivery remains a valid use case, but the product is defined around funded Claims: value that can be addressed before the recipient's final wallet is known. The economic inbox is the claimant-facing surface for discovering and tracking those Claims.

## D-002 — A Claim represents funded value

A Claim must be backed by escrowed value before it is presented as available. Unfunded promises, points, advertisements, and speculative opportunities are not Claims.

## D-003 — Arc and USDC are the foundation of the current release

Current campaign escrow, lifecycle state, settlement, and recovery live on Arc. USDC is the funded and settled asset. Arc integration must be part of the value flow rather than a decorative deployment.

## D-004 — The blockchain is authoritative for money and lifecycle state

On-chain state and canonical events determine funding, availability, settlement, expiry, and recovery. The database is an index and workflow store and must reconcile to the chain rather than override it.

## D-005 — Custody trust and Gate trust are separate

Funding and settlement guarantees are enforced on-chain. Eligibility may depend on on-chain evidence or a named off-chain Resolver. The product must disclose the source and assurance level of each Gate rather than describing attested facts as trustless.

## D-006 — Active escrow cannot be confiscated or redirected

No owner or administrator may sweep active Claim escrow. No single approver or relayer can consume or redirect a Claim, and an approved payout cannot be altered. Settlement requires the claimant's signed wallet selection and both independent Gate attestations over that exact payout. Unused funds can move only through the recovery rule established for the Claim.

The contract cannot independently prove ownership of an off-chain identity. Collusion between both Gate authorities remains an explicit Gate-trust risk: they could falsely assign an unconsumed entitlement to a wallet they control and obtain that wallet's signature. Wallet consent proves wallet control, not identity ownership. These limits must be disclosed rather than described as trustless identity verification.

## D-007 — Claim authorizations are single-use and domain-bound

The current authorization model uses domain-separated EIP-712 signatures. An authorization is bound to the campaign, claimant wallet, amount, chain ID, verifying contract, nonce or nullifier, and deadline. A signature for another context must be invalid.

## D-008 — Private identity data stays off-chain

Raw email addresses, social identifiers, secrets, and private eligibility records are not stored on-chain or emitted in public logs. Public settlement must not reveal the underlying identifier.

## D-009 — The current release is one narrow campaign flow

The current product supports a fixed allocation per claimant, one declared Resolver-backed eligibility source, direct USDC settlement, opening and expiry times, issuer reclaim, and an inbox with Available, Completed, and Expired states.

## D-010 — The normal claimant experience abstracts gas acquisition

A claimant does not need to understand Arc gas mechanics or manually acquire a separate gas token to receive a Claim. The resulting Arc transaction remains visible without making gas preparation part of the ordinary user journey.

## D-011 — The economic inbox is a funded-value surface

Items shown as Claims must correspond to verifiably funded value. The inbox is not an advertising feed, and the business model will not depend on selling claimant identity data.

## D-012 — Financial expansion follows proof of direct settlement

Direct USDC Claims must be reliable before the product introduces more complex settlement behavior. Arbitrary external execution is not part of the current Claim Core.

## D-013 — The legacy MVP is not approved as the production custody boundary

The existing GiftLink application is product evidence, but its escrow, authorization, relayer, ABI, and state assumptions are not trusted for production Claim custody without revalidation. The current Claim Core must satisfy the new custody and authorization guarantees.

## D-014 — Meaningful-value custody requires independent review

A working deployment or successful demonstration is not a security audit. Mainnet proofs use deliberately limited value, and value limits do not increase until the relevant custody and authorization design has received independent review.

## D-015 — The current scope has no protocol token or open execution market

The current product does not require a protocol token, token governance, permissionless Resolver market, permissionless solver market, or unrestricted settlement adapters.

## D-016 — Nomine is the parent brand

The Claim Layer and economic inbox use **Nomine** as their parent brand, with the master line **“Value, addressed.”** The principal surfaces are Nomine Inbox, Nomine Studio, and Nomine Protocol. The original gifting application remains a focused product called **GiftLink by Nomine** rather than defining the boundary of the broader system.

## D-017 — Original Claim Register is the canonical Nomine identity

The approved symbol is the original rectangular-block Claim Register from the first brand review (route 03). The later sliced diagonal N was explicitly rejected. The round-02 palette, typography and overall application aesthetic were approved. Implementation uses `brand/IMPLEMENTATION.md` and `brand/approved/`, including canonical SVGs unchanged, outlined wordmark lockups, local fonts and shared colour tokens. Explorations are historical and must not be used as production logo sources. Applying the brand does not expand product scope or change custody guarantees.

## D-018 — Nomine evolves the existing codebase around a new Claim Core

Nomine is developed as a distinct Claim Layer product within the existing repository, reusing validated application foundations from GiftLink. The legacy custody contract, authorization assumptions, and scattered lifecycle state are not inherited as the new Claim Core. Nomine Inbox and Studio are built around the fixed-allocation campaign flow defined in the current build brief.

The first work package is a foundation audit and implementation brief: map the existing flows, identify what to retain, repair, or replace, and define the campaign lifecycle and acceptance criteria before implementation. Material product and architectural choices are resolved with the product architect; implementation mechanics belong to the implementation agent.

The approved Nomine identity may be applied to the new product flow without making a complete GiftLink makeover a prerequisite or expanding V1. GiftLink remains a focused application, GiftLink by Nomine; migration of legacy records, links, and custody requires an explicit plan and is not implied by a name change.

## D-019 — V1 requires independent issuer and Resolver attestations

Approved September 26, 2026. Each V1 settlement requires both the campaign's issuer and Nomine Resolver to attest the same payout after the claimant signs their selected wallet. The claimant request and both domain-separated attestations bind the exact campaign, entitlement, wallet, amount, chain ID, verifying contract, and deadline. Neither approver nor the relayer can substitute another wallet into that signed payout. The contract must verify wallet consent and both distinct approving authorities; a signature from either authority alone is insufficient.

The issuer key remains outside Nomine's infrastructure and control. The issuer independently verifies the identity-to-wallet assignment through a known channel, rather than blindly approving information presented by Nomine. Two keys under Nomine's control do not satisfy this decision. Manual issuer confirmation is limited to the first controlled pilot and is not the intended long-term claimant experience; a later replacement requires an explicit design decision preserving the trust boundary.

The claimant interface must disclose the confirmation requirement before requesting consent and display **Awaiting issuer confirmation** while it is pending. This is a workflow status within the V1 inbox experience, not evidence that a Claim has settled. Expiry still applies while confirmation is pending.

Each listed entitlement is fully funded for the fixed USDC allocation, single-use, and represented by a high-entropy, campaign-specific identifier. Funding fixes a commitment covering the actual entitlement identifiers, and settlement proves membership and consumes that identifier. No raw identity data appears on-chain or in events. The same entitlement cannot be consumed again with another wallet, signature, or deadline. Membership does not independently prove off-chain identity ownership.

Funded campaigns are immutable: no upgrades, approving-key replacement, eligibility changes, or early withdrawal. Allocation, membership commitment, approving authorities, opening time, expiry, and recovery destination are fixed at funding. Unused funds remain recoverable only after expiry under that fixed rule, without requiring claimant consent or either Gate attestation. Losing an approving key can prevent settlement until expiry; it must not prevent expiry recovery. The pilot uses the issuer address as the fixed recovery destination. Relay sponsorship is funded separately and does not reduce the promised allocation.

Required verification includes either signer acting alone, missing or invalid claimant consent, replay across payout contexts, wallet substitution, fabricated membership, expired approvals, double settlement, timing boundaries, full funding and conservation, prohibited campaign mutations, and expiry recovery when either approver is unavailable. Collusion between both Gate authorities remains the explicit risk described in D-006, not a guarantee that tests can establish away.

## D-020 — Pre-opening Claims are Available, gated by an explicit Opens label

Approved September 26, 2026. A funded Claim whose campaign has not yet reached its opening time appears in
the claimant's inbox under **Available**, carrying an explicit **Opens <date and time>** label with the
relevant timezone, and claiming stays disabled until opening. It is never presented as immediately
claimable.

Approval and transaction workflow states — **Awaiting issuer confirmation**, awaiting Resolver attestation,
and pending submission — are workflow statuses inside **Available**, not lifecycle groups. The three
claimant-facing lifecycle groups remain **Available**, **Completed**, and **Expired**.

Oversubscription is not reintroduced anywhere. The deployed Claim Core funds every listed entitlement for
its own allocation, so an eligible unconsumed entitlement with no backing is a reconciliation error rather
than a first-come allocation window or a fabricated **Expired** state.

## D-021 — Delegated auto-approval

Approved October 14, 2026. Automatic approval is the default: a campaign whose `issuerApprover` is the
Nomine-held auto-approver key is approved by Nomine as soon as the claimant's verified email matches its
entitlement and the claimant signs, so Nomine operates both the issuer-approver and Resolver authorities.
The auto-approver key is distinct from the Resolver (`BACKEND_SIGNER`) and the relayer, and is checked at
startup. An issuer who wants a second key held independently selects **manual** mode by supplying their own
`issuerApprover` address, which preserves the D-019 two-key trust boundary unchanged. Delegated approval is
bounded by the configured campaign caps (`MAX_CAMPAIGN_BUDGET_USDC`, `MAX_CAMPAIGN_RECIPIENTS`), which limit
per-campaign exposure. D-019 remains available as manual mode and is superseded as the default.

