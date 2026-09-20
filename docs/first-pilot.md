# First pilot: a funded Claim for a community member

This is the first small test of the larger Claim and economic inbox vision. It is a working hypothesis, not a promise to build every part of the protocol now.

## The problem to investigate

A community or protocol has a reward budget and wants to give a specific amount to eligible members. Today it may have to identify wallets, assemble a list, prevent duplicate claims, distribute funds, answer support questions, and recover unused money. We need to learn which of those steps is genuinely painful and worth solving.

## The proposed experience

An issuer funds a USDC reward pool and declares who qualifies. For the first pilot, eligibility should use **one** clearly named source: either a wallet allowlist at a fixed snapshot or a community-maintained membership attestation. The system shows the trust source plainly.

An eligible member discovers a funded Claim through a link or inbox, proves eligibility, and receives USDC without paying claim gas. The issuer sees settlement records and can recover unused funds after the agreed expiry.

The first pilot has one outcome: **direct USDC transfer**. Swaps, LP positions, grants, agents, and cross-chain settlement stay out of this test. They are later modules if the core journey works.

## What this pilot must prove

1. An issuer has an actual budget and a concrete reason to distribute it this way.
2. Eligibility can be defined and checked without creating unreasonable friction or false claims.
3. The recipient trusts the funding status and completes the Claim.
4. A repeated claim is prevented.
5. Unclaimed funds return under clear rules.
6. The transaction, database record, and issuer view agree after failures or retries.

We should validate the first point in conversations before building the rest.

## The next seven days

- **Day 1:** Use this brief to identify five possible issuers: community operators, grant programs, game teams, or protocols that already run rewards. Select people with an observable reward program, not simply people with a large following.
- **Days 2–4:** Ask for three short discovery conversations. Do not pitch a finished platform. Learn how their most recent distribution worked.
- **Days 4–5:** Record the repeated pain points, budget size, eligibility source, and recipient complaints. Decide whether this pilot addresses a real problem.
- **Days 6–7:** Revise the pilot scope. If one issuer is interested, sketch its exact issuer and recipient screens and the transaction flow. If no one has the problem, choose another use case rather than forcing this one.

The dates are a suggested pace, not a deadline. One useful conversation is progress.

## Discovery questions

Ask about a specific recent event rather than whether they like a hypothetical product.

1. What was the last reward, refund, grant, or incentive you distributed? To how many people?
2. How did you decide who qualified? Who or what was trusted to make that decision?
3. How did you collect destinations or wallet addresses? What happened when someone did not have one?
4. What went wrong: duplicate claims, wrong recipients, bots, unclaimed funds, support tickets, fees, or delays?
5. How much staff time did the process take? What would you change next time?
6. If the funds were committed before recipients claimed, would that make the process easier or harder for your treasury?
7. Would you consider testing a small funded Claim in your next real program? What would need to be true first?

Listen for a real upcoming program, a named decision-maker, a budget, and a willingness to test. Praise for the idea alone is weak evidence.

## A low-pressure outreach message

> Hey — I’m building a way for protocols and communities to fund rewards for eligible people before collecting everyone’s wallet address. I’m trying to understand how teams actually run these distributions. I saw your [specific program/event]. Could I ask you a few questions about how eligibility, claims, and unclaimed funds worked? No sales pitch; I’m looking for honest feedback on the problem.

Personalize the bracketed sentence. Do not mass-send this unchanged.

## What to share and keep private

It is reasonable to share the problem, the funded Claim journey, and a small demo. Keep keys, private user data, unreviewed contract code, and detailed implementation plans private until there is a reason to share them. The aim of early conversations is to learn how the issuer works, not to hand over a full technical blueprint.

## The build decision

Build a narrow testnet prototype only after the conversations identify a concrete use case. Before holding meaningful mainnet value, the Claim contract needs a new custody and authorization design, refund paths, state reconciliation, tests, and independent review. The current GiftLink MVP is evidence of the user experience, not a safe production foundation for this protocol.

## One-line explanation

> We let an organization fund value for eligible people before knowing their final wallet, and let those people discover and claim it through an economic inbox.
