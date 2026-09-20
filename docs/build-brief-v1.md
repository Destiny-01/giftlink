# V1 Build Brief: Arc Claim Proof

**Status:** Current build target  
**Date:** September 19, 2026  
**Target:** Public, working Arc mainnet proof before the Arc Microgrants deadline  
**Internal submission target:** October 7, 2026  

## Why this document exists

This is the handoff between the product-planning task and implementation tasks. It defines the first complete product slice to build now.

The broader product is a Claim Layer with an economic inbox. V1 is deliberately smaller. It must prove that an organization can fund USDC for eligible people before collecting their final wallets, and that those people can discover and claim the value through a simple experience.

See `docs/product-roadmap.md` for how this release unlocks the later product, developer platform, Claims network, and financial-program phases.

Do not expand V1 to include every use case described in the architecture documents.

## Product sentence

> An organization funds USDC Claims for eligible people; those people authenticate, prove eligibility, and receive the funds on Arc through an economic inbox without needing to understand the underlying blockchain flow.

## The demonstration story

A community operator creates a small reward campaign for verified members:

1. The issuer defines a fixed USDC amount per eligible member, a total budget, an eligibility source, and an expiry.
2. The issuer funds the campaign on Arc.
3. A member opens a shared Claim link and signs in using a supported identity method.
4. The application verifies the member against the campaign's declared eligibility source.
5. A resolver issues a single-use authorization bound to the campaign, claimant wallet, amount, chain, contract, nonce, and deadline.
6. The Claim settles USDC on Arc and produces a visible receipt.
7. The Claim appears as completed in the member's economic inbox and in the issuer's campaign view.
8. After expiry, the issuer can reclaim unused funds according to rules fixed when the campaign was created.

The first demonstration may use a small team-controlled allowlist behind the resolver. It must still show the eligibility source and trust model clearly in the interface.

## Users in V1

### Issuer

A community, protocol, or organization operator distributing a small reward budget.

### Claimant

An eligible community member who may not have provided a wallet before the campaign was funded.

### Developer

For V1, the developer surface is a documented example showing how a campaign can be created or queried. A complete public SDK is a later milestone.

## Required product scope

### Claim Core

Build a new minimal Claim Core suitable for this proof. It should support one fixed-allocation campaign model with:

- Issuer address.
- Native USDC asset configuration for Arc.
- Total funded budget.
- Fixed amount per successful claimant.
- Maximum number of settlements or equivalent budget cap.
- Gate commitment and trusted resolver/verifier.
- Opening and expiry times.
- Remaining balance and settlement count.
- Single-use claimant authorization.
- Deterministic reclaim of unused funds after expiry.
- Canonical creation, funding, settlement, expiry/reclaim, and status events.

The contract must enforce:

- Full backing of every available allocation.
- Conservation of campaign funds.
- No repeated settlement by the same entitlement.
- Domain-separated EIP-712 authorization bound to the chain ID and verifying contract.
- Authorization bound to campaign ID, claimant wallet, amount, nonce/nullifier, and deadline.
- No owner or administrator sweep of active campaign escrow.
- No ability for a resolver, relayer, or administrator to redirect a claimant's settlement.
- Reclaim only under the campaign's predefined expiry rules.

Keep the contract small. Do not add arbitrary external calls or a general settlement adapter in V1.

### Eligibility resolver

Support one declared Gate:

> The authenticated claimant is present in the issuer-approved eligibility set and has not consumed the entitlement.

The first implementation can use a private allowlist of normalized email or social identifiers. Store only a salted commitment or equivalent private representation where appropriate. Never publish raw identifiers on-chain.

The backend must verify the authenticated identity before signing an authorization. A UI or request parameter alone is never proof of identity.

### Claimant experience

The claimant must be able to:

- Open a campaign or Claim link.
- See the issuer, funded status, amount, eligibility source, expiry, and trust explanation.
- Sign in and create or connect a wallet.
- Learn whether they qualify without exposing another person's eligibility.
- Claim without manually acquiring a separate gas token.
- Recover cleanly from a pending, replaced, retried, or already-confirmed transaction.
- See an Arc transaction receipt and completed Claim in the economic inbox.

The inbox only needs three useful states for V1:

- Available.
- Completed.
- Expired.

### Issuer experience

The issuer must be able to:

- Create a campaign with a fixed amount, cap/budget, eligibility source, opening time, and expiry.
- Review the configuration before funding.
- Fund it with USDC on Arc.
- Obtain a shareable link.
- See funded, claimed, remaining, and expired/reclaimed amounts.
- See settlement receipts.
- Reclaim unused funds after expiry.

### Coordination backend

The backend should provide:

- Authenticated identity verification.
- Private eligibility lookup.
- EIP-712 authorization issuance.
- Idempotent create, authorize, relay, and reconcile operations.
- Event indexing with chain state winning over database state.
- Transaction retry and replacement handling.
- An audit trail for eligibility decisions without leaking raw private identifiers.
- Configuration for Arc testnet and mainnet without unsafe silent defaults.

Gas sponsorship may use the current relayer for the proof if it is repaired and strictly scoped. Circle wallet or gas tooling can be adopted if it is available on Arc and improves the delivery without weakening the trust model.

## Arc and Circle integration

V1 must make Arc part of the actual value flow:

- Campaign escrow lives on Arc.
- USDC is the funded and settled asset.
- Claim state and receipts are anchored in Arc events.
- Expiry and reclaim are enforced on Arc.
- Arc explorer links are visible in the product.
- The application handles Arc's USDC-denominated gas experience.

The implementation should document which Circle components are used. Arc and USDC are mandatory. Circle Wallets, Paymaster/Gas Station, App Kits, Gateway, and CCTP should only be added when they perform a real function in the V1 flow. Decorative integrations are out of scope.

## Explicitly out of scope

- Swaps and liquidity positions.
- Settlement adapters or arbitrary callbacks.
- Milestone grants and reviewer voting.
- Streams, vesting, and recurring Claims.
- Cross-chain Claims, Gateway routing, or CCTP movement.
- Open resolver or solver marketplaces.
- A full external SDK and webhook platform.
- Agent-issued Claims.
- Protocol token or governance.
- A complete rebrand.
- Meaningful-value production custody before independent contract review.

These remain part of the product roadmap. They are not acceptance requirements for this build.

## Known MVP concerns to re-confirm during audit

The existing code is evidence and reusable material, not a trusted production foundation. The implementation task should verify these known concerns before deciding what to retain:

- A social relay path may not enforce recipient verification consistently.
- The existing contract may allow an owner to sweep escrow.
- Confirmation or recording paths may trust transaction receipts or database state too much.
- Frontend, backend, and deployed contract ABIs may have drifted.
- Expiry and refund behavior may be incomplete or inconsistent.
- Recipient edits may update only database state.
- Identity normalization or matching may differ across flows.
- Testnet defaults may be unsafe for a mainnet release.

Do not patch around a custody or authorization flaw merely to preserve the old contract interface. Prefer a new small contract and explicit migration path.

## Required verification

At minimum, tests must demonstrate:

1. A funded eligible claimant settles exactly once.
2. An ineligible claimant cannot obtain or use a valid authorization.
3. A signature for another wallet, campaign, chain, contract, amount, nonce, or deadline fails.
4. A replayed authorization fails.
5. Claims before opening and after expiry fail.
6. Only the designated issuer receives the predefined expired balance.
7. An administrator cannot redirect or sweep active escrow.
8. Total funded value always equals settled value plus remaining/reclaimed value, subject only to explicitly modeled fees.
9. Backend retries do not create duplicate settlement records or conflicting state.
10. The application can reconstruct the correct state from Arc events after database interruption.

Use deliberately limited funds for any mainnet proof. A successful demo is not an audit.

## Definition of done

V1 is complete when:

- A reviewer can open a public live application.
- The reviewer can identify what Arc is doing in the product.
- A small campaign is visibly funded with USDC on Arc mainnet.
- An eligible new user can authenticate and complete the Claim flow.
- A duplicate or unauthorized Claim is rejected.
- The claimant and issuer surfaces agree with on-chain state.
- An expired unused allocation can be reclaimed correctly.
- The public repository contains reproducible setup and deployment documentation.
- Contract addresses, transaction links, and Arc configuration are documented.
- A short demo video shows the entire issuer-to-claimant lifecycle.
- The project is ready for the Arc Microgrants submission form.

## Build sequence

### Phase 0: audit and decisions

- Map the existing frontend, backend, contracts, identity flow, and relay flow.
- Reproduce the known concerns.
- Decide what will be reused and what will be replaced.
- Record short decisions for the campaign state machine, authorization model, relayer model, and upgrade policy.

### Phase 1: Claim Core

- Write the state machine and invariants.
- Implement the minimal contract.
- Add unit, authorization, replay, expiry, reclaim, and accounting tests.
- Deploy and verify on Arc testnet.

### Phase 2: resolver and coordination

- Implement strict identity-to-entitlement verification.
- Issue domain-separated authorizations.
- Make relay and reconciliation idempotent.
- Index canonical events.

### Phase 3: product flow

- Build the issuer campaign flow.
- Build the claimant flow and the three-state inbox.
- Add receipts, trust explanations, failure recovery, and explorer links.

### Phase 4: release

- Complete end-to-end and adversarial testing.
- Prepare public documentation and demo data.
- Deploy a limited-value Arc mainnet proof after explicit approval.
- Record a short demo and submit before the internal October 7 target.

## First implementation-task instruction

The implementation task should begin by reading this brief and the referenced product documents, then audit both applications. It should produce a concrete implementation plan tied to the current codebase and proceed through the build without silently expanding the V1 scope.
