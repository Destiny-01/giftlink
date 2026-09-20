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

No owner, administrator, Resolver, or relayer may sweep active Claim funds or redirect settlement away from the authorized claimant. Unused funds can move only through the recovery rule established for the Claim.

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
