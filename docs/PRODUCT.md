# Product

## Purpose

The product is a **Claim Layer** with an **economic inbox**.

A Claim is funded value addressed to a person, group, condition, or machine before the final receiving wallet is known. It lets an organization reserve real value for an eligible recipient, define when it can be accessed, and enforce what happens if it is claimed or left unused.

The original GiftLink experience—sending USDC through a link to an identity—is the simplest expression of this product, not its full boundary.

## Product model

Every Claim defines:

- **Capital:** the asset and amount already funded.
- **Gate:** who qualifies and what evidence establishes eligibility.
- **Availability:** when the Claim can be settled and when it expires.
- **Settlement:** the approved result of a successful Claim.
- **Recovery:** where unused value goes after expiry.

A Claim is not an invoice, promise, points balance, or advertisement. Its value is already escrowed and independently verifiable.

## Users and surfaces

- **Claimants** use the economic inbox to discover, understand, settle, and track value available to them.
- **Issuers** use an organization console to create, fund, publish, monitor, and reconcile Claim programs.
- **Developers and protocols** integrate Claims into their own products through a programmatic interface and embedded experiences.
- **Resolvers** verify declared eligibility conditions that cannot be proven directly on-chain.

These are different interfaces over the same Claim lifecycle rather than separate products.

## Core behavior

- Claims are fully funded before they become available.
- The issuer, amount, funding status, eligibility source, settlement outcome, expiry, and recovery rule are visible to the claimant.
- Eligibility may be proven on-chain or attested by a named trusted Resolver. The product makes that trust source explicit.
- A claimant authenticates, connects or creates a wallet, signs the exact payout they are requesting, and settles to that wallet.
- Each entitlement can settle only once. The claimant's signed request and both independent attestations bind the campaign, entitlement, wallet, amount, chain, contract, and deadline, so a request cannot be replayed or redirected to another wallet.
- Settlement requires the claimant's consent plus **both** an independent issuer attestation and a Nomine Resolver attestation over that exact signed request. Neither authority alone, and no relayer, can settle a Claim or choose the payout wallet.
- A funded campaign's rules are immutable: no upgrades, authority or approving-key replacement, eligibility edits, or changes to allocation, times, or recovery destination, and no early withdrawal.
- Claimants do not need to manually acquire a separate gas token to complete the normal claim experience.
- Expired, unused value returns only according to the recovery rule fixed for the Claim.
- On-chain state and events are authoritative for funding, settlement, and recovery. Off-chain data supports identity, eligibility workflows, indexing, notifications, and presentation.
- The economic inbox contains verifiably funded items. It is not an advertising feed.

## Trust and privacy

The protocol minimizes custody trust while stating Gate trust honestly.

Active escrow cannot be swept or redirected. No owner, administrator, Resolver, relayer, or single approver can consume or alter an approved payout, and funded campaigns are immutable. Funding conservation, settlement uniqueness, expiry, and recovery are enforced on-chain; unused funds after expiry are returned under the recovery rule fixed at funding, without requiring claimant consent or either Gate attestation.

The contract cannot prove ownership of an off-chain identity. Wallet consent proves control of the wallet, not ownership of the identity behind an entitlement, and a fixed eligibility commitment does not eliminate that. Collusion between the two Gate authorities remains an explicit Gate-trust risk: they could assign an unused entitlement to a wallet they control and sign as that wallet. The product discloses this rather than presenting attested facts as trustless. The issuer approval key is held outside Nomine, and the issuer independently verifies the identity-to-wallet assignment through a known channel.

Some eligibility facts originate outside the blockchain. The system does not present those facts as trustless; it identifies the Resolver or issuer responsible for them and enforces the resulting authorization consistently.

Raw email addresses, social identifiers, secrets, and private eligibility data are not published on-chain or included in public logs. Claimants should be able to check their own eligibility without exposing another person's status.

## Current product scope

The current release is an Arc-native proof of the core issuer-to-claimant loop:

- A fixed-allocation community campaign funded with USDC on Arc, where every listed entitlement is fully backed by its own allocation and there is no eligible-list oversubscription.
- One clearly declared, Resolver-backed eligibility source, fixed at funding.
- A single-use authorization for each eligible claimant.
- Dual attestation: the claimant signs the payout, then an independently held issuer approval and a Nomine Resolver approval attest that exact signed request.
- Immutable funded rules: allocation, entitlement commitment, approving authorities, opening time, expiry, and the issuer's fixed recovery cannot change after funding.
- Direct USDC settlement only.
- Opening time, expiry, and deterministic issuer reclaim that requires neither Gate attestation nor claimant consent.
- An issuer view of funded, settled, remaining, and reclaimed value.
- A claimant experience with **Available**, **Completed**, and **Expired** inbox states, plus an **Awaiting issuer confirmation** workflow status while an approval is pending.
- Arc transaction receipts and explorer visibility.

The current release does not include swaps, liquidity positions, arbitrary settlement callbacks, milestone programs, streams, cross-chain settlement, open Resolver or solver markets, agent-issued Claims, or a protocol token.

## Important user flows

### Create and fund a campaign

1. An issuer defines the fixed amount per claimant and the funded entitlement set — its size is the budget — plus the eligibility source, opening time, and expiry. Recovery returns to that issuer.
2. The product presents the complete configuration for review.
3. The issuer funds the campaign with USDC on Arc.
4. The campaign becomes discoverable through a shareable Claim experience, with its funding and rules visible.

### Claim funded value

1. A claimant opens the Claim and sees the issuer, amount, funding status, Gate, expiry, and settlement outcome.
2. The claimant authenticates and connects or creates a wallet.
3. The interface discloses the confirmation requirement, and the claimant signs the exact payout — campaign, entitlement, their selected wallet, amount, chain, contract, and deadline.
4. The Resolver verifies the declared eligibility condition and the issuer independently verifies the identity-to-wallet assignment through a known channel. Both then attest the same signed request. While an approval is pending, the inbox shows **Awaiting issuer confirmation** — a workflow status, not a settled receipt; expiry still applies while it is pending.
5. A sponsored transaction settles USDC on Arc once the claimant's consent and both attestations are present.
6. The claimant receives an on-chain receipt and the inbox records the Claim as completed.

### Expire and recover

1. Once the declared expiry passes, no new settlement is permitted.
2. The issuer reclaims only the unused campaign balance.
3. The issuer view, claimant view, and indexed records reconcile to the on-chain result.

## Terminology

| Term | Meaning |
|---|---|
| **Claim** | A funded, gated, settleable entitlement with explicit recovery rules. |
| **Campaign** | A funded Claim program that supports multiple eligible settlements under shared rules. |
| **Issuer** | The person or organization that defines and funds a Claim. |
| **Claimant** | The eligible recipient who proves entitlement and settles a Claim. |
| **Gate** | The policy that defines eligibility and availability. |
| **Resolver** | A named service or authority that verifies an off-chain condition and authorizes settlement. |
| **Attestation** | A signed statement about an identity, status, or event used to satisfy a Gate. |
| **Settlement** | The on-chain execution of an approved Claim outcome. |
| **Economic inbox** | The claimant-facing record of funded Claims that are available, completed, or expired. |
| **Recovery** | The predefined return of unused value after expiry. |
| **Nullifier / nonce** | A unique value used to prevent an entitlement or authorization from being reused. |

