# Feasibility Assessment and Product Roadmap

## Purpose

This document turns the Claim-layer and economic-inbox vision into an executable plan. It answers three questions:

1. Which parts can be built with established technology?
2. Which parts depend on ecosystem maturity, audits, partners, or further research?
3. In what order should the product, protocol, and organization be developed?

The planning ranges are directional rather than delivery promises. Progress should be governed by completion gates and evidence, not calendar pressure.

## Executive assessment

The central system is feasible:

- Fully funded Claims can be represented in EVM smart contracts.
- Claim eligibility can be enforced through on-chain proofs or signed Attestations.
- Claimants can be onboarded through email, social accounts, embedded wallets, or external wallets.
- Gas can be sponsored or reimbursed.
- Organizations can configure programs through a console and SDK without writing Solidity.
- An economic inbox can index Claims relevant to identities a user chooses to connect.
- Reviewed settlement adapters can route approved Claims to transfers, swaps, streams, vaults, or liquidity positions.

The complete long-term vision is not one feature release. Some later capabilities—private eligibility proofs, open verification markets, cross-chain state, subjective dispute systems, transferable Claims, and autonomous agent markets—require independent validation, audits, liquidity, governance, and possibly legal work.

The correct assurance is therefore:

> The core architecture is technically achievable with established EVM patterns. The larger network can be reached through staged, independently useful releases. We should not promise that every advanced module is equally ready or necessary before users prove demand for it.

## Current platform context

Arc public mainnet launched on September 16, 2026. Circle describes it as EVM-compatible, with native USDC gas and deterministic sub-second finality. It also launched application tooling for payments, swaps, onramps, yield, wallets, and bridges. These characteristics are favourable for sponsored stablecoin Claims.

Arc launch does not remove application-level requirements. Claim custody, authorization, indexing, privacy, adapter safety, dispute policy, and issuer adoption remain our responsibility.

## Feasibility matrix

### High-confidence: established patterns

These can be designed and implemented now.

| Capability | Technical basis | Principal work |
|---|---|---|
| Individual USDC Claim | Escrow contract and one-time authorization | Redesign current contract and lifecycle |
| Campaign Claim pool | Budget accounting, per-identity nullifiers and caps | Efficient storage and allocation rules |
| Wallet allowlists | Merkle proofs | Snapshot tooling and proof delivery |
| Token/NFT Gates | Contract reads or committed snapshots | Block pinning and anti-flash-loan policy |
| Email/social Gates | OAuth plus signed Attestation | Resolver security and private identity binding |
| Time conditions | Block timestamps | Clear expiry and reclaim semantics |
| Gas-sponsored settlement | Relayer or account abstraction | Reliable estimation, retries and multiple operators |
| Economic inbox | Off-chain indexing and private identity matching | Privacy, notification and issuer reputation |
| Organization console | Standard web application and role controls | Treasury, program builder and reporting UX |
| API, SDK and webhooks | Conventional service architecture | Typed schemas, idempotency and developer docs |
| Direct and split settlement | Restricted adapters | Allowlisting and atomic accounting |
| Milestone approval | Signed reviewer threshold | Evidence workflow and explicit trust display |

### Medium-confidence: feasible with dependencies

These are technically understood, but success depends on liquidity, partners, audits, operational maturity, or careful product design.

| Capability | Dependency or risk | Required proof before launch |
|---|---|---|
| Swap settlement | Reliable Arc liquidity and venue adapter | Route simulation and bounded slippage |
| Simple LP settlement | Suitable USDC pair and understandable position | Atomic adapter audit and claimant consent |
| Vault settlement | Safe, liquid vault with clear withdrawal rules | Strategy review and loss disclosure |
| Streaming/vesting | Long-lived accounting and cancellation policy | Formal state-machine tests |
| Organization-funded grant escrow | Treasury acceptance and reviewer governance | Design partner and legal/operational review |
| External Resolvers | Key management and service reliability | Resolver specification and assurance labels |
| Permissionless solvers | Enough settlement flow to attract operators | Sustainable fees and anti-griefing rules |
| Embedded integrations | Partner willingness and stable APIs | One lighthouse integration |
| Multi-asset Claims | Token risk and varying token behaviour | Asset policy and per-token tests |

### Research-heavy or later-stage

These remain part of the architectural horizon, not the initial promise.

| Capability | Why it comes later |
|---|---|
| ZK identity and membership proofs | Circuit design, proving UX and audits |
| Confidential Claims | Privacy infrastructure and compliance implications |
| Cross-chain Claims | Bridge security and multi-domain state consistency |
| General dispute markets | Economic design, arbitration and governance |
| Staked Resolver marketplace | Slashing correctness and sufficient market demand |
| Transferable Claims | Bearer-instrument and regulatory implications |
| Claim-backed lending | Valuation, liquidation and enforceability |
| Fully autonomous agent commerce | Identity, policy controls and verifiable work outputs |
| Permissionless arbitrary adapters | Extreme smart-contract attack surface |

## What must be true for the product to succeed

Technical feasibility alone is insufficient. We need evidence for five product assumptions:

1. **Issuers have recurring distribution problems.** At least one issuer should identify a real upcoming program, budget, and decision-maker.
2. **Recipients complete identity-gated Claims.** The experience must be simpler than collecting wallets and distributing directly.
3. **Pre-funding is acceptable.** Issuers must be willing to lock campaign value under explicit refund rules.
4. **Eligibility has a credible source.** Every pilot needs a definition of membership that users and the issuer accept.
5. **The inbox adds value beyond a link.** Over time, users must benefit from returning to see multiple Claims rather than only opening isolated links.

The first pilot tests the first four. The inbox network thesis is tested only when multiple issuers or repeated programs exist.

## Roadmap principles

- Protect money before expanding features.
- Validate issuer demand before building broad configurability.
- Begin with a closed catalogue of Gates and settlement adapters.
- Make every trust assumption visible.
- Keep chain state authoritative and database operations recoverable.
- Make every phase useful without depending on the next phase.
- Introduce financial complexity only after direct settlement is reliable.
- Use partnerships for identity, liquidity, wallets, and infrastructure instead of rebuilding them.

## Workstream 0: Founder and market discovery

**Status:** active now.

### Objective

Find one issuer with an upcoming distribution problem suitable for a small funded pilot.

### Current action

The builder-channel request has been sent. Responses should be tracked with:

- Person and project.
- Role and decision authority.
- Upcoming program.
- Approximate budget and number of recipients.
- Current distribution method.
- Eligibility source.
- Primary pain.
- Willingness to test.
- Follow-up date.

### While waiting

- Prepare a 20-minute discovery call structure from `docs/first-pilot.md`.
- Create a simple response tracker.
- Identify five additional people whose projects visibly run rewards, grants, refunds, or contributor programs.
- Draft a one-screen pilot mockup rather than a full redesign.
- Avoid offering mainnet custody or fixed delivery dates.

### Exit gate

At least three informative conversations and one credible design-partner candidate with a real use case. If no common pain emerges, revisit the first use case before writing the protocol.

## Workstream 1: Product constitution and V1 definition

**Suggested planning range:** one to two focused weeks, overlapping discovery.

### Deliverables

1. **Product constitution**
   - Definition and guarantees of a Claim.
   - Economic-inbox rules.
   - Trust disclosure principles.
   - Explicit non-goals.

2. **V1 product requirements**
   - Issuer persona and claimant persona.
   - Exact pilot Gate.
   - Funding, claiming, expiry and refund journey.
   - Success measures and failure states.

3. **Journey diagrams and wireframes**
   - Issuer program creation.
   - Claim discovery and verification.
   - Gas-sponsored settlement.
   - Issuer reporting and refund.

4. **Architecture decision records**
   - Campaign pool versus one contract record per claimant.
   - Off-chain permit versus on-chain Gate proof.
   - Relayer model.
   - Upgradeability policy.
   - Identity privacy model.

### Exit gate

One complete user journey can be explained without referring to future LP, grant, agent, or cross-chain features.

## Workstream 2: Protocol foundation

**Suggested planning range:** six to ten weeks for implementation and internal verification, depending on final scope. External review follows separately.

### Objective

Replace the MVP contract with a small Claim Core safe enough for testnet piloting and suitable for independent review.

### Contract scope

- Fully backed USDC Claims.
- Individual and campaign Claim modes.
- Monotonic identifiers.
- Gate and settlement commitments.
- Nonces and replay protection.
- Opening and expiry times.
- Deterministic refunds.
- Claimant nullifiers or consumed-allocation records.
- Direct settlement.
- Bounded protocol and relayer fees.
- Pausing without administrator confiscation.
- No administrator withdrawal of active escrow.
- Events sufficient to reconstruct all state.

### Backend scope

- Idempotent create, fund, authorize, relay and refund operations.
- Event indexer with chain-wins reconciliation.
- Transaction replacement and retry handling.
- Hardware-backed or managed signer design.
- RPC failover.
- Audit log for Gate evaluations.
- Per-Claim or per-program privacy salts.

### Verification

- Unit tests for state transitions.
- Invariant and fuzz tests for conservation of funds.
- Authorization and replay tests.
- Failure recovery tests.
- Independent review before meaningful mainnet value.

### Exit gate

Every unit of escrow can be accounted for through creation, settlement, expiry, refund, failure and retry. No privileged key can redirect or sweep active Claims.

## Workstream 3: Pilot product

**Suggested planning range:** four to six weeks after the V1 contract interface stabilizes; product work can overlap contract testing.

### Claimant surface

- Link entry and inbox preview.
- Issuer identity and funding verification.
- Gate explanation and assurance label.
- Privy or equivalent identity onboarding.
- Wallet creation or connection.
- Gas-sponsored direct settlement.
- Receipt and recovery from interrupted sessions.

### Issuer surface

- Create a program.
- Define one supported eligibility source.
- Set amount, budget, cap and expiry.
- Fund using a wallet or multisig.
- View eligible, settled, remaining and expired allocations.
- Export records and recover unused funds.

### Initial Gates

Ship only what the pilot requires, selected from:

- Wallet allowlist.
- Merkle snapshot.
- Token ownership at a pinned block.
- Email identity.
- One named community Resolver.

### Exit gate

One external issuer funds a controlled program and real participants successfully settle test or deliberately limited-value Claims. Refund and retry paths are exercised, not merely demonstrated.

## Workstream 4: Developer platform

**Suggested planning range:** four to eight weeks after the pilot API becomes stable.

### Deliverables

- Versioned REST API.
- TypeScript SDK.
- Typed Gate descriptors.
- Webhooks for lifecycle events.
- Embeddable claim component.
- Sandbox environment and example application.
- Integration and security documentation.
- API keys, usage limits and organization roles.

### Exit gate

An unaffiliated developer can issue, display and reconcile a direct Claim without assistance from the core team or deployment of a custom contract.

## Workstream 5: Open verification and settlement

**Time horizon:** after successful pilots and stable direct settlement.

### Capabilities

- Resolver registry and assurance labels.
- Composite Gates.
- External Resolver SDK.
- Settlement Router and adapter standard.
- Direct, split and basic swap adapters.
- Multiple relayers or permissionless solvers.
- Fee quotes and action-aware gas reserves.
- Adapter simulation and risk metadata.

### Exit gate

An external Resolver establishes eligibility and an independent solver settles a Claim correctly. At least one integration generates repeat use.

## Workstream 6: Long-lived and financial Claims

**Time horizon:** after direct Claims demonstrate repeat issuer demand.

### Candidate modules

- Milestone grant escrow.
- Threshold reviewer approvals.
- Tranches, streams and vesting.
- Recurring Claims.
- DEX swap settlement.
- Simple LP positions.
- Reviewed vault deposits.
- Challenge periods for attested conditions.

Each module requires its own product demand, threat model, integration review and acceptance criteria.

### Exit gate

At least one Claim program remains active for months and progresses through multiple funded releases without manual treasury payments.

## Workstream 7: Network expansion

**Time horizon:** earned through adoption rather than scheduled now.

- Wallet-native Claim rendering.
- Multiple chains and cross-chain settlement.
- Private eligibility proofs.
- Machine-readable inboxes.
- Agent-issued Claims.
- Specialized Resolver and solver markets.
- Portable Claim standards.

## Parallel company-building roadmap

The technology roadmap must be accompanied by organizational work.

### Design partners

Develop relationships with communities, grant programs, games, merchants, protocols and developer platforms. Seek access to their workflow and next campaign rather than endorsements of the broad vision.

### Advisers

The most useful early advisers are:

- A smart-contract security engineer.
- A protocol product or growth operator who has run incentives.
- An identity or Attestation specialist.
- A founder familiar with enterprise or protocol integrations.
- Legal counsel before transferable, private, cross-border, credit or disputed Claims.

Advisers should review specific decisions. Avoid assembling a ceremonial advisory board.

### Pitch materials

Create these progressively:

1. One-page pilot brief.
2. Five-screen clickable product story.
3. Working testnet demonstration.
4. Ten-slide partner deck.
5. Technical integration brief.
6. Investor deck only when the wedge, pilot evidence and funding requirement are clear.

### Branding

Brand strategy should start after the product constitution and first journey stabilize, but before public pilot recruitment. The identity must accommodate the consumer inbox, organization console, and protocol. Trademark, domain and ecosystem checks follow the naming shortlist.

## Decision queue

The following decisions should be made in order:

1. Which first issuer problem are we solving?
2. What exact evidence qualifies a claimant?
3. Is V1 an individual Claim, campaign pool, or both?
4. Which parts of the Gate are enforced on-chain?
5. What are the refund and expiry rules?
6. Who sponsors settlement and how are fees quoted?
7. What is the minimal claimant identity model?
8. What information is public, committed, encrypted, or private?
9. Which administrative powers exist, and how are they constrained?
10. What evidence is required before mainnet value increases?

LP routing, agent commerce, cross-chain Claims and tokens should not enter this queue until the relevant phase.

## Metrics by phase

### Discovery

- Informative issuer conversations.
- Upcoming programs identified.
- Design partners willing to test.
- Repeated pain points.

### Pilot

- Funding completion rate.
- Eligible claimant verification success.
- Claim completion rate.
- Time from opening to settlement.
- Support cases per Claim.
- Refund correctness.
- Issuer willingness to run a second program.

### Platform

- Active issuers.
- Repeat issuers.
- Settled value.
- Active integrations.
- Claims created through third-party applications.
- Resolver accuracy and uptime.
- Solver competition and settlement cost.

Inbox registrations and page views are secondary until repeat funded Claims exist.

## Immediate action plan

### While builder-channel responses arrive

1. Track responses and schedule discovery calls.
2. Finalize the product constitution from the existing architecture document.
3. Draw the exact first-pilot sequence and trust boundaries.
4. Write the Claim Core state machine before writing Solidity.
5. Audit the current code against Arc mainnet configuration without deploying funds.
6. Prepare a low-fidelity issuer and claimant prototype.
7. Identify a contract-security reviewer for the design stage.

### When someone indicates interest

1. Confirm their actual upcoming program and decision authority.
2. Map their current process and failure points.
3. Select the narrowest supported Gate.
4. Agree on test budget, participant count, environment and success criteria.
5. Write a pilot brief specific to them.
6. Do not promise unsupported custom conditions during discovery.

### If nobody responds

Follow up individually with five relevant builders using specific observations about their programs. Lack of channel response is not product invalidation. If direct conversations also reveal no urgency, change the first use case while preserving the Claim primitive.

## Final plan

The immediate objective is not to build every use case. It is to establish a trustworthy Claim Core and prove one issuer-to-claimant loop.

The ordered path is:

```text
Issuer discovery
      ↓
Product constitution and V1 journey
      ↓
Claim Core and trust model
      ↓
Controlled testnet pilot
      ↓
Limited-value external program
      ↓
Developer API and SDK
      ↓
Open Gate and settlement modules
      ↓
Long-lived Claims and economic inbox network
```

We can preserve the large vision while making each next step small, testable and useful.
