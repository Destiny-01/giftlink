# Nomine — proposed strategy and verbal identity

Status: draft elaboration of the approved foundation. Product authority: `docs/BRAND.md`, `docs/PRODUCT.md`, `docs/DECISIONS.md`.

## Strategy

Purpose: let funded value reach its eligible destination even when its final wallet is not yet known.

Category: Claim Layer. Human entry point: economic inbox. Promise: understand what value backs a Claim, why you qualify, how it settles and what happens if it expires.

Positioning: For organizations addressing value and people eligible to receive it, Nomine is the Claim Layer that combines funded capital, eligibility, availability, settlement and recovery in one object. Its economic inbox makes that object understandable; its protocol makes it integrable.

Differentiation rests on the combination, not claims of uniqueness: funding precedes availability; entitlement precedes the final wallet; rules persist through recovery; the trust source is named; interfaces share the same lifecycle. Do not claim that every underlying mechanism is novel.

Principles: funding before promotion; rules before persuasion; people before wallet mechanics; evidence before assurance; one lifecycle across every surface. Personality: composed, exact, considerate, quietly confident. Never aloof, mystical or triumphalist.

Narrative: An issuer knows who value is for before knowing where it will settle. Nomine gives that value a funded Claim with explicit conditions. The economic inbox brings the Claim to the eligible person. Settlement resolves its destination; a receipt records the result. If unused, the original recovery rule still applies.

Current proof (in development): a fixed-allocation USDC community campaign on Arc, one named Resolver-backed eligibility source, direct settlement and deterministic issuer recovery. This describes the proof being built, not a live campaign. Broader protocol purpose is not a statement that future settlement types are shipped.

## Architecture

| Name | Use and naming rule |
| --- | --- |
| Nomine | Parent brand/network; say the full name on first reference |
| Nomine Inbox | Claimant experience; “your inbox” permitted after introduction |
| Nomine Studio | Issuer environment; no separate logo or palette |
| Nomine Protocol | Contracts and integration infrastructure; specify actual available components rather than implying all APIs/SDKs are released |
| GiftLink by Nomine | Focused gifting application; GiftLink leads, endorsement secondary but readable |
| Partner integrations | “Claims powered by Nomine” only for actual Claim integration; identify partner as issuer/Resolver where applicable |
| Future verticals | Do not name, draw lockups for, or market until approved as real products |

## Voice and copy library

Lead with the fact, then explain its implication, then offer one next action. Use active verbs and sentence case. Capitalize Claim as the object; use lowercase claim as a verb. “Available” is a lifecycle state, not proof of personal eligibility. “Funded” is not a guarantee that a particular person qualifies.

One line: **Nomine makes funded value addressable and claimable.**

Short description: Nomine is a Claim Layer with an economic inbox. Issuers fund value and define who can claim it. Eligible recipients can understand the rules and settle to a wallet.

Long description / boilerplate: Nomine makes value addressable before its final receiving wallet is known. A Claim combines funded capital with eligibility, availability, settlement and recovery rules. Nomine Inbox helps people discover, understand and track these Claims; Nomine Studio supports issuers; Nomine Protocol supplies the underlying infrastructure. The current release focuses on fixed-allocation USDC campaigns on Arc, with a named eligibility Resolver and direct settlement. GiftLink by Nomine expresses the same idea through gifting.

Social bio: Value, addressed. The Claim Layer and economic inbox for funded value. Built on Arc.

Founder introduction: “I’m building Nomine, a Claim Layer with an economic inbox. Organizations can fund value for eligible people before knowing their wallets. We’re proving that loop with USDC Claims on Arc.”

| Audience | Headline | Supporting copy | CTA |
| --- | --- | --- | --- |
| Claimant | What’s yours should find you. | See who funded a Claim, who verifies eligibility and when it expires. | Check eligibility |
| Eligible claimant | This Claim is ready to settle. | Settle 250 USDC to your connected wallet on Arc. | Review settlement |
| Issuer | Fund value now. Define how it can be claimed. | Set the allocation, eligibility source, availability and recovery destination before funding. | Review campaign |
| Developer | Make value claimable. | Capital, conditions and settlement in one programmable object. | Explore the Claim lifecycle |
| Partner | Bring funded Claims to your community. | Define the issuer and the eligibility verifier. Make both visible to recipients. | Discuss an integration |
| GiftLink | Send value before you know the wallet. | A focused gifting application by Nomine. | Create a gift |

Use only CTAs whose destinations exist. These examples are copy proposals, not announcements of shipped flows.

## State and proof language

| Situation | Copy |
| --- | --- |
| Funding confirmed | This Claim is funded. View funding transaction. |
| Eligibility unchecked | Eligibility is verified by DevRel Collective. Check eligibility. |
| Ineligible | You do not meet this Claim’s eligibility requirements. View requirements. |
| Resolver unavailable | We couldn’t verify eligibility. Try again. Your Claim has not settled. |
| Awaiting confirmation | Settlement submitted. Waiting for confirmation on Arc. |
| Confirmed | Completed. 250 USDC settled to your wallet. View transaction. |
| Expired | This Claim expired on 24 September 2026 at 18:00 UTC. |
| Recovery rule | Unused capital returns to the issuer after expiry. |
| Recovery status | Recovery pending. / Reclaimed: 2,500 USDC. Use the state supported by chain data. |
| Empty inbox | No available Claims. Claims appear here when funded value is addressed to you. |

Show the actual issuer, asset, amount, chain, Resolver, deadline with timezone, recovery destination and evidence link. “Verified” must name what was verified and by whom. A checkmark alone must never stand for identity, funding and security at once.

Preferred: fund, address, qualify, claim, settle, route, recover, verify. Translate Gate to “eligibility requirements” for consumers; explain Resolver as the named eligibility verifier. Use route only when an actual route choice exists.

Avoid: free money, alpha, moon, degen, guaranteed returns, risk-free, bank-grade, fully trustless, fully decentralized, instant, any wallet, no wallet needed, audited (without applicable evidence), official Arc partner (without authorization). Never imply a token, swaps or cross-chain settlement in the current release.
