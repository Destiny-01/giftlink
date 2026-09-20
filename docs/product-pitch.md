# Product Pitch: The Economic Inbox and Claim Layer

## The opening

Crypto has become very good at moving value between wallet addresses.

But the world does not operate through wallet addresses. It operates through people, communities, purchases, achievements, agreements, milestones, applications, and increasingly, autonomous agents.

Today, if a protocol owes a user a reward, a company owes a customer a refund, or a grant program owes a developer a milestone payment, they must first identify a wallet and then build a custom distribution process around it.

That process is fragmented across spreadsheets, Merkle airdrops, vesting contracts, support tickets, claim pages, multisends, and manual approvals.

We are building the missing layer: **funded value that can be addressed before the destination wallet is known.**

## The product

At the centre of the product is a new object called a **Claim**.

A Claim is funded value reserved for a person, group, condition, or machine. It defines:

- Who can access the value.
- When it becomes available.
- What can happen when it is accepted.
- When unused funds return to the issuer.

The money is already there. It is held in verifiable escrow. A Claim is not a promise, points balance, or promotional message.

The simplest Claim looks familiar: someone sends USDC to an email address or social identity, and the recipient opens a link to receive it without needing an existing wallet or gas.

But the same primitive can support far more:

- A protocol reward for verified community members.
- A customer refund delivered without collecting wallet addresses.
- A grant that releases across approved milestones.
- A bounty funded before the worker is known.
- A recurring contributor allocation.
- A sponsored DeFi position.
- A payment from an autonomous agent after work is verified.

These are not separate products. They are Claims with different eligibility and settlement rules.

## The economic inbox

For end users, Claims appear in an **economic inbox**.

Instead of showing only what someone already owns, the inbox shows what is waiting for them across the internet:

```text
12 USDC refund available
500 USDC grant tranche approved
50 USDC community reward ready to claim
100 USDC available after completing an activity
Next contributor allocation unlocks Friday
```

The inbox answers a question no wallet answers well today:

> What value, rights, rewards, refunds, and funded opportunities am I entitled to across the applications I use?

Users connect identities and wallets they already control. The inbox privately discovers relevant Claims, explains why each one is available, and guides the user through settlement.

The user does not need to understand bridging, gas, token approvals, or smart accounts before receiving value. Their first on-chain action can simply be accepting something that already belongs to them.

## Why the inbox is different from email

Traditional messages are free to send, so inboxes become filled with spam.

Every item in this economic inbox is collateralized. If an issuer wants to place a 20 USDC Claim in someone's inbox, the issuer must actually fund it.

That creates a simple rule:

> Every message carries verifiable value.

Claims can also display the issuer, funding status, eligibility source, expiry, and trust level. Users can block issuers and control external notifications. Unknown or low-reputation issuers can be filtered automatically.

The result is not an advertising feed. It is a queue of funded economic possibilities.

## What organizations receive

Organizations use a console or API to define a Claim program without writing Solidity.

They choose:

1. A budget and asset.
2. Who qualifies.
3. When value becomes available.
4. How the claimant may receive or use it.
5. What happens to unused funds.

For example, a protocol could fund 50,000 USDC for verified contributors. Eligibility might require a community role, an on-chain snapshot, and one unique claim per person.

The protocol can offer direct USDC or let claimants enter an approved liquidity position. Every successful settlement is tracked, every unclaimed balance follows predefined recovery rules, and the protocol no longer needs to build its own airdrop and onboarding infrastructure.

A grant organization can fund an entire award upfront, define six milestones, select a reviewer threshold, and let approved tranches appear automatically in the grantee's inbox.

A merchant can issue refunds to customer identities before asking those customers to create wallets.

## How eligibility works

The system does not pretend to possess universal knowledge about users.

Eligibility is expressed through transparent Gates.

Some Gates are verified directly on-chain:

- Wallet ownership.
- Token ownership.
- Snapshot membership.
- Time and contract state.
- Cryptographic proofs.

Other Gates depend on named attesters:

- A community confirms a Discord role.
- A merchant confirms a purchase.
- A reviewer approves a milestone.
- An application confirms user activity.

Each Claim declares who is trusted to verify its conditions. Users can see whether eligibility was verified on-chain, attested by an organization, or approved by named reviewers.

This does not turn subjective facts into mathematical truth. It makes trust visible and enforceable.

## The settlement layer

When a valid claimant arrives, the Claim can settle directly or execute through a reviewed integration.

Possible outcomes include:

- Receive USDC.
- Split value between destinations.
- Stream value over time.
- Swap into another asset.
- Bridge to another network.
- Enter an approved vault.
- Create a liquidity position.
- Activate an application-specific benefit.

Settlement is atomic. If a swap exceeds the claimant's price-impact limit or an LP position cannot be created within agreed parameters, the transaction reverts and the Claim remains available.

The recipient sees and approves the outcome. Risky financial actions are never hidden behind a generic claim button.

## Why this belongs beside DEXes and dApps

DEXes answer:

> How can an existing asset holder exchange one asset for another?

We answer:

> How can funded value reach the correct future holder under the correct conditions and settle into the correct outcome?

DEXes make value exchangeable. We make value addressable.

The protocol can originate useful activity for the rest of Web3:

- DEXes receive funded swap and liquidity flow.
- Vaults receive informed deposits.
- Games distribute rewards without collecting addresses.
- DAOs fund grants and contributor allocations.
- Marketplaces issue refunds and incentives.
- Wallets display Claims natively.
- Agents post and settle funded obligations.

Applications can render Claims inside their own products while the economic inbox provides a universal claimant experience.

## The network effect

The system connects four participants:

- Issuers bring funded value.
- Claimants bring identities and demand.
- Verifiers bring trusted eligibility signals.
- Solvers and applications bring settlement routes.

More funded Claims attract more claimants and settlement operators. Better settlement attracts more issuers. More claimants make eligibility integrations more useful. Better eligibility reduces fraud and allows organizations to fund larger programs.

The long-term moat is not an escrow contract. It is the network of resolvable identities and conditions, trusted issuers and verifiers, settlement flow, and integrations adopted across applications.

## Business model

The business earns when value successfully reaches a claimant.

Revenue can include:

- A small fee on settled value.
- A share of relayer or solver fees.
- Routing fees for paid verification services.
- Organization subscriptions for permissions, reporting, analytics, private programs, and service guarantees.
- Integration economics with DEXes, vaults, and other settlement destinations.

The claimant experience remains free for normal use. The inbox does not depend on advertising or selling identity data.

## Go-to-market progression

The first release focuses on a narrow, credible foundation:

- Secure, fully funded USDC Claims.
- Individual and campaign eligibility.
- Wallet, allowlist, token, email, and social Gates.
- Gas-sponsored settlement.
- A useful economic inbox.
- Organization console, API, webhooks, and embedded claim pages.

The next release opens verification and settlement modules to external applications, adding swap settlement and independent settlement operators.

Longer-lived programs then introduce milestones, tranches, streams, recurring Claims, LP positions, and more private eligibility proofs.

Cross-chain Claims and autonomous agent commerce follow after the core has earned trust.

## Closing pitch

Crypto does not need another payment dashboard or another airdrop tool.

It needs a way for value to find the right person—even when their wallet is not yet known—and to arrive with clear conditions, verifiable funding, and a useful outcome.

We are building a protocol for funded Claims and an economic inbox where people and machines discover value they are entitled to receive, unlock, or execute.

The envelope is the experience people touch.

The Claim is the primitive applications integrate.

The economic inbox is the network people return to.

> Somewhere across the internet, money, rewards, refunds, grants, opportunities, and agreements may already belong to you. They should have somewhere to arrive.
