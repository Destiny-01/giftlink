# Nomine V1 Implementation Brief — First Campaign

**Status:** Proposal for review. Defines the first campaign lifecycle and a bounded implementation
sequence. It is **not** an implementation, a deployment, or a security audit, and it does not assert
that any of the described behaviour exists today.

**Authority and precedence:** `docs/PRODUCT.md` governs product meaning, `docs/DECISIONS.md` governs
settled choices, and `docs/build-brief-v1.md` governs current release scope. This brief elaborates
those documents; it never overrides them. Where this brief proposes something not yet settled, it is
labelled **Proposal** and is listed in §10 for the product architect to resolve. Nothing in §10 has
been added to `docs/DECISIONS.md`.

**Prerequisite reading:** `docs/foundation-audit.md` (what exists today), `docs/BRAND.md`,
`brand/IMPLEMENTATION.md`, `brand/approved/GUIDELINES.md`.

---

## 1. Settled requirements this brief must satisfy

These are not open for redesign here. They come from D-002 to D-015, `docs/PRODUCT.md` and
`docs/build-brief-v1.md`.

| # | Requirement | Source |
| --- | --- | --- |
| R1 | Every Claim is fully backed by funded value before it is presented as available | D-002, PRODUCT |
| R2 | One campaign: fixed allocation per claimant, funded cap, one declared eligibility source, opening and expiry, deterministic issuer reclaim | D-009, build brief |
| R3 | Direct USDC settlement on Arc only; no swaps, adapters, or arbitrary external calls | D-012, D-015, build brief |
| R4 | Each entitlement settles exactly once; authorizations are single-use and domain-bound | D-007, PRODUCT |
| R5 | No owner, administrator, Resolver, or relayer may sweep active escrow or redirect settlement away from the authorized wallet | D-006 |
| R6 | Unused value moves only through the recovery rule fixed at funding | D-006, PRODUCT |
| R7 | Chain state and canonical events are authoritative; the database reconciles to the chain and never overrides it | D-004 |
| R8 | Raw identifiers, secrets, and private eligibility records are never on-chain or in public logs | D-008 |
| R9 | The normal claimant does not manually acquire a separate gas token | D-010 |
| R10 | The Inbox has exactly three presentation states: Available, Completed, Expired | D-009, build brief |
| R11 | Eligibility, funding, and availability remain separate facts; off-chain eligibility is never described as trustless | D-005, PRODUCT |
| R12 | The legacy MVP custody, authorization, relayer, ABI and state assumptions are not inherited | D-013 |
| R13 | No protocol token, no open Resolver/solver market, no upgradeable settlement adapters | D-015 |

---

## 2. First campaign: scope

The first campaign is the smallest thing that proves the loop. It has exactly one of each variable:

- **One asset:** USDC, native to Arc (R3).
- **One allocation:** a fixed amount per successful claimant, identical for every claimant.
- **One cap:** a funded budget that bounds the number of settlements. `cap = floor(budget / allocation)`
  is a *consequence* of funding, not an input to be trusted separately. A budget that is not an exact
  multiple of the allocation therefore leaves a **remainder** — `budget − cap × allocation`, always less
  than one allocation — which can never be settled. The remainder is not forfeited: it is part of the
  recoverable balance and is returned under the recovery rule (§3.1, I2, §11 row 29). Requiring exact
  divisibility at funding would be a simpler alternative, but it is **not** the chosen rule: the
  remainder path above is the specification. Funding must additionally satisfy `budget >= allocation`,
  so that `cap >= 1` and a campaign is never created unable to settle anything.
- **One eligibility set:** a single declared private allowlist resolved by a named Resolver.
- **One opening time and one expiry time**, both fixed at funding.
- **One recovery rule**, fixed at funding.

Explicitly **out of scope** for the first campaign, per the issue's non-goals: multiple Gates,
partial or variable allocations, multiple assets, streaming or milestone settlement, cross-chain
settlement, top-ups, extensions of expiry, transfers or secondary sale of entitlements, and any
claimant-initiated redirection of settlement.

---

## 3. Claim lifecycle

Three lifecycles exist at once and must not be conflated. The on-chain lifecycle is the truth; the
transaction workflow is the machinery that reaches it; the Inbox is how a person reads it.

### 3.1 On-chain lifecycle (authoritative)

The central design recommendation is **not to store a lifecycle status enum on-chain**. (This is an
implementation choice inside the implementation agent's remit, not a product decision: the requirement
is only that no stored status may disagree with chain facts.) The legacy contract stores `status`
(`link-backend/contracts/GiftLink.sol:35-38`, set at `:200`) and keeps it in step with a database
column and an hourly job (`link-backend/src/jobs/expireDropsJob.ts:6-52`) — and the audit found the two
can disagree. Instead, store **facts** and derive the phase from facts plus the clock:

Stored facts: `fundedAmount`, `settlementCount`, `allocation`, `openingTime`, `expiryTime`, whether the
reclaimable balance has been returned, plus per-entitlement nullifier consumption. Nothing else is
stored. `cap`, the remainder, the settled total and the reclaimable total are all determined by those
facts, and a stored copy of any of them would be one more value that can disagree with the chain.

Derived, so that no separate stored value can disagree with the facts:

- `cap = floor(fundedAmount / allocation)`
- `allocatedTotal = cap × allocation`
- `remainder = fundedAmount − allocatedTotal` — never settleable, always `< allocation`
- `settledAmount = settlementCount × allocation` — exact, because every settlement transfers exactly
  `allocation` (I3)
- `remainingUnsettled = (cap − settlementCount) × allocation`
- `reclaimable = fundedAmount − settledAmount = remainder + remainingUnsettled`
- `reclaimedAmount` = the `reclaimable` value at the moment reclaim executed, fixed thereafter

The reclaim flag is the one piece of state that cannot be derived: once the remainder reaches zero, a
fully settled campaign and a reclaimed one both hold nothing, so the contract must record that reclaim
happened rather than infer it.

Funding must also satisfy `fundedAmount >= allocation`, so that `cap >= 1` and the campaign is not
born unable to settle anything. Without that guard a budget below one allocation yields `cap == 0`,
which makes settlement impossible from the start and makes reclaim immediately available — coherent
arithmetically, but a degenerate campaign that should be rejected at funding instead.

Derived campaign phase:

| Phase | Predicate | Money at rest |
| --- | --- | --- |
| `Unfunded` | `fundedAmount == 0` | none |
| `Funded, not yet open` | funded, `now < openingTime` | entire budget |
| `Open` | funded, `openingTime <= now < expiryTime`, `settlementCount < cap` | `funded − settled` |
| `Exhausted` | funded, `settlementCount == cap` | `remainder` (may be 0) |
| `Expired` | `now >= expiryTime`, not reclaimed | `funded − settled` |
| `Reclaimed` | the reclaimable balance has been returned per the recovery rule | 0 |

Settlement is permitted **only** while all three hold: funded, `openingTime <= now < expiryTime`, and
`settlementCount < cap`.

Reclaim is permitted **only** once settlement is no longer possible — that is, when `now >= expiryTime`
**or** `settlementCount == cap` — and transfers exactly `reclaimable = fundedAmount − settledAmount`,
which is the remainder plus every allocation that was never settled. It never touches the settled
portion and never transfers more than the campaign holds. There is one governing condition, not two:
whether settlement can still occur. `Exhausted` and `Expired` are therefore not mutually exclusive, and
`Exhausted` does **not** mean the escrow is empty when the budget was not an exact multiple of the
allocation.

Because the phase is derived, it cannot drift: there is no transition to forget, no job required to
notice an expiry, and no state a permissionless caller can grief. Note this is a deliberate correction
of the `markExpired` deadlock in the legacy contract (`GiftLink.sol:290-295` versus `:332-338`), where
a third party can permanently block the sender's only refund path.

### 3.2 Entitlement lifecycle (per eligible identity, per campaign)

| State | Meaning | Exits |
| --- | --- | --- |
| `NotEligible` | identity is not in the declared set | — |
| `Eligible` | Resolver confirms membership; entitlement not yet consumed | → `Authorized` |
| `Authorized` | a single-use authorization has been issued and is unexpired | → `Settled`, or expiry → `Eligible` |
| `SettlementPending` | a settlement transaction is submitted and unconfirmed | → `Settled`, or failure → `Eligible` |
| `Settled` | nullifier consumed on-chain (terminal) | — |

The `Authorized → Eligible` exit is the retry path: an authorization that expires, or that fails
against a reverted transaction, may be replaced by a fresh authorization **for the same entitlement**.
Only `Settled` is terminal, and only the chain can reach it.

### 3.3 Transaction workflow (off-chain machinery)

Distinct from the on-chain lifecycle, and where the audit's most serious defects live.

```
claimant authenticates (Privy identity token)
  → Resolver: is this identity in the declared set, and is the entitlement unconsumed?
  → coordination service issues one domain-bound authorization (idempotent per entitlement)
  → sponsored settlement submitted to Arc
  → chain consumes the nullifier and settles USDC directly to the authorized wallet
  → receipt verified by decoding the canonical event, not by trusting a supplied hash
  → campaign and entitlement projections updated from that event
```

Failure and retry rules:

- **Authorization issuance is idempotent per entitlement.** Re-requesting before settlement returns
  the same live authorization rather than creating a second entitlement.
- **Submission is idempotent per authorization.** A retry with the same authorization must not produce
  a second settlement; the on-chain nullifier is the backstop, not the service's memory.
- **A replaced or dropped transaction is retried with the same authorization**, and produces exactly
  one settlement row.
- **A pending settlement is never shown as Completed.** R5/D-004 require confirmation by event.
- **Verification is by canonical event decode** — the legacy code accepts any successful receipt hash
  (`link-backend/src/services/dropService.ts:697-703`) and would otherwise let the database assert a
  settlement that never happened.
- **The Resolver is unavailable:** no authorization is issued; the Claim is not settled; the claimant
  sees a retryable message. Silence is never success.

### 3.4 Inbox presentation states

Three states only (R10), each derived from the facts above — never from a database status column:

| Inbox state | Derived from | Copy obligation |
| --- | --- | --- |
| **Available** | campaign `Open`, claimant `Eligible` or `Authorized` | show issuer, amount, asset, network, eligibility verifier, expiry **with timezone**, recovery rule |
| **Completed** | entitlement `Settled` on-chain, receipt decodable | show settled amount and the transaction reference |
| **Expired** | `now >= expiryTime` and this entitlement was never settled | state the expiry and that unused capital returns to the issuer |

`Available` is a lifecycle state, not a claim that the viewer personally qualifies. A funded campaign
the viewer is not part of is not shown in their Inbox at all.

### 3.5 Boundary behaviours (no fourth state required)

| Situation | Behaviour | Why it does not add a state |
| --- | --- | --- |
| Before opening (`Funded, not yet open`) | Claim is visible with the opening time stated; settlement is refused. Availability is not yet true. | Resolves to `Available` once open, or to `Expired` if opening is never reached |
| After budget exhaustion (`Exhausted`) | Settlement is refused; remaining eligible identities see the campaign as no longer available. Any remainder from a non-divisible budget becomes recoverable to the issuer. | Terminal-until-expiry, then `Expired`; the remainder is a recovery fact, not a fourth state |
| Between exhaustion and expiry | Nothing is offered; no queue, no waitlist, no partial allocation | R2/R3 forbid partial settlement |
| After expiry, unsettled | `Expired` with the recovery statement | Terminal |
| After reclaim | Nothing offered | Reclaim is an issuer-side fact, not a claimant state |

---

## 4. Trust boundaries

| Actor | May | May **not** | Enforced where |
| --- | --- | --- | --- |
| Issuer | create a campaign, fund it, reclaim the unused balance after expiry under the fixed rule | withdraw active escrow, change allocation/cap/opening/expiry/recovery after funding, redirect a settlement | contract (R5, R6) |
| Resolver / eligibility verifier | assert membership of a declared identity in the declared set, for a named campaign, within a validity window | move funds, choose the settlement amount, redirect settlement, consume an entitlement | off-chain assertion; the contract only accepts authorizations from the campaign's declared Resolver commitment (R5, R11) |
| Coordination service / backend signer | issue one authorization per unconsumed entitlement, sponsor submission | reuse or alter an already-issued authorization; defeat the nullifier or the domain binding | contract, for those two properties only — see the signer-trust note below |
| Relayer | submit a valid authorization and receive a defined, capped reimbursement | choose the recipient, alter the amount, submit without a valid authorization | contract (R5) |
| Claimant | authenticate, prove eligibility, settle once to their own wallet | settle twice, settle for another identity, settle outside the window, be paid to an address other than the authorized one | contract nullifier + authorization binding (R4) |
| Anyone | read public state and events | — | — |

**Signer trust is separate from contract enforcement.** The contract can verify that an authorization
presented to it is authentic, unexpired, unused, and bound to this campaign, chain, contract, amount and
claimant. It **cannot** verify that the signer used the identity-derived nullifier for the claimant's
own entitlement, or the wallet the claimant actually selected — both are inputs to the signed data. A
compromised or malicious signer can therefore authorize a different wallet, or a duplicate nullifier for
an entitlement that has not yet been consumed, and the contract will honour it.

Two cases must be kept apart:

- **Altering an existing authorization** — changing the amount, retargeting the wallet, extending the
  deadline, or moving it to another campaign, chain, or contract — is prevented on-chain by the domain
  binding and the nonce.
- **Issuing a new, malicious authorization** for the wrong wallet, or for an entitlement that should not
  be settleable, is **not** prevented on-chain. It is a trusted-operator property.

Closing that second gap is an architectural decision, not an implementation mechanic. The available
mechanisms are a campaign-scoped signer key with rotation (Q6), threshold or multi-party signing (Q6),
and committing the eligibility set at funding (Q1) so that a nullifier belonging to no eligible
entitlement is detectable. That last mitigation is conditional and partial: it requires the Gate
commitment to cover the entitlement nullifiers themselves and `settle()` to prove membership against it,
neither of which the Phase A sketch includes, and it still cannot detect a nullifier swapped for a
*different* eligible entitlement. Until one of these is chosen, the honest statement is: **custody and
single-use are enforced by the contract; the correctness of each authorization is enforced by the
signer.** No interface may describe the second as cryptographically guaranteed. Rows 30–31 of §11 record
this as a trust boundary rather than a passing test.

**Off-chain eligibility is attested, not trustless.** The interface names the Resolver. The system
never describes a Resolver-attested fact as cryptographically proven, and never presents a checkmark
as standing for identity, funding, and security at once (R11, D-005).

---

## 5. Accounting invariants

Must hold at all times, and must be asserted by tests rather than assumed:

- **I1 — Full backing:** at all times, `fundedAmount − settledAmount >= (cap − settlementCount) × allocation`.
  Every settlement that can still occur is already funded. The difference is exactly `reclaimable`, and
  it equals the remainder only when the campaign is exhausted.
- **I2 — Conservation, exactly:** before reclaim, `fundedAmount == settledAmount + remainingUnsettled + remainder`;
  after reclaim, `fundedAmount == settledAmount + reclaimedAmount`. Both forms must hold with no
  unmodelled slack: any fee must be an explicit term, and a non-divisible budget must appear as
  `remainder`, not as an unexplained difference.
- **I3 — Fixed allocation:** every settlement transfers exactly `allocation`; there is no path that
  transfers another amount, and no path that settles a partial allocation.
- **I4 — Cap:** `settlementCount <= cap`. Reaching `cap` is a hard stop on settlement, not on escrow:
  the remainder may still be held until it is reclaimed.
- **I5 — Single settlement per entitlement:** the set of consumed nullifiers has no duplicates, and
  `settlementCount == |consumed nullifiers|`.
- **I6 — No sweep:** no issuer, owner, admin, Resolver, or relayer action can reduce escrow attributable
  to still-settleable entitlements before settlement becomes impossible, or move anything beyond
  `reclaimable` once it has.
- **I7 — Reclaim is bounded and exact:** reclaim transfers exactly `reclaimable = fundedAmount − settledAmount`;
  afterwards `fundedAmount == settledAmount + reclaimedAmount` and no further settlement is possible.
- **I8 — Reimbursement is bounded:** relayer compensation is capped per settlement and cannot scale
  with campaign value (contrast the legacy gas tank, which is a per-drop balance the relayer receives
  in full — `GiftLink.sol:249-254`).

The legacy system holds none of I1, I4, I5 or I6, and exposes I2 to `emergencyWithdrawUSDC()`
(`GiftLink.sol:410-413`). This is why the custody contract is a *replace*, not a *repair*
(`docs/foundation-audit.md` §3).

---

## 6. Entitlement uniqueness

The rule: **one entitlement per eligible identity per campaign, settleable exactly once.**

Key derivation (**Proposal**, see §10 Q2):

```
entitlementNullifier = H(campaignId, identityCommitment)
```

- `identityCommitment` is derived from the normalized identity using a server-held secret, and is
  never published raw (R8).
- The nullifier is **not** derived from the authorization signature. This is the specific defence the
  issue requires: a re-issued signature for the same entitlement must not create a second settlement.
  Uniqueness lives in the identity, and the contract consumes the nullifier.

Consequences that must be explicitly handled:

| Scenario | Required behaviour |
| --- | --- |
| Claimant retries after a failed or reverted transaction | Fresh authorization for the **same** entitlement; nullifier still unconsumed; exactly one settlement eventually lands |
| Authorization expires unused | A new authorization may be issued for the same entitlement; the expired one must be unusable |
| Claimant changes wallet before settling | A new authorization may name the new wallet, because the entitlement is per identity, not per wallet. The old authorization must not remain usable — bind it to a nonce that is superseded, and to the authorized wallet (R4) |
| Same identity appears twice in the eligibility set | Must be de-duplicated by the Resolver at admission, and must still yield one nullifier |
| Two different identities resolve to the same wallet | Both may be entitled; each settles once to that wallet. Never merges entitlements |
| Cross-campaign | The same identity may settle once in each campaign; the nullifier is campaign-scoped |
| Chain/DB divergence after interruption | The consumed-nullifier set and the financial projections are rebuilt from canonical events; a database that lost the record must not permit a resettlement. Private eligibility data, identity mappings, and secret material are **not** reconstructible from events and must be restored from protected backups first (§11 row 22, §12 item 7) |

The legacy system fails this requirement structurally: uniqueness rests on the drop's status
transition (`GiftLink.sol:229,244`) with no identity-scoped nullifier, and the database records
settlement from a client-supplied hash (`dropService.ts:697-703`).

---

## 7. Implementation sequence

Bounded, each phase gated on the previous. Phases A–D are the minimum for the proof. The sequence
deliberately puts correctness before surface: the audit found that the correct eligibility logic
already exists but is wired to an unused path (`dropService.ts:370-424` versus `:501-583`), so
**re-pointing the live claim path at strict verification is the first correctness win, and it can
precede the new contract.**

### Phase A — Claim Core (contract + tests)

Build the minimal contract defined in the build brief. Deliverables:

- Campaign struct holding: issuer, USDC asset, funded amount, allocation, gate commitment,
  declared Resolver, opening time, expiry time, settlement count, and a reclaim flag. `cap`, the
  remainder, and the settled and reclaimable totals are derived exactly as in §3.1, so none of them is a
  stored field: storing them would only create something that can disagree with the facts. Funding
  requires `fundedAmount >= allocation` so that `cap >= 1` (§3.1).
- `settle(entitlementNullifier, claimant, amount, deadline, nonce, signature)` with EIP-712 domain
  separation, nullifier consumption before transfer, and a fixed `allocation` transfer directly to the
  authorized wallet.
- `reclaim()` callable by the issuer only, and only once settlement is no longer possible — `now >= expiryTime`
  **or** `settlementCount == cap` — transferring exactly `reclaimable = fundedAmount − settledAmount` to
  the recovery destination fixed at funding. The remainder of a non-divisible budget is ordinary escrow
  here, so it needs no separate recovery path.
- Canonical events: campaign created, funded, settled, reclaim-enabled, reclaimed.
- **No owner sweep function at all.** The absence is the guarantee (R5).

Depends on: nothing. This is the root dependency for everything else.

Testing gate: the full adversarial matrix in §11 rows 1–18 must pass in unit tests before Phase B begins.

### Phase B — Resolver and coordination

Reuse and repair, do not rewrite (`docs/foundation-audit.md` §3):

- **Keep:** Privy identity resolution and server-derived wallet binding
  (`link-backend/src/services/authService.ts:28-60,83-146`), the Express/Zod structure, rate limiting.
- **Replace** `relayClaim`'s empty recipient check with the strict verification already present in
  `issueClaimPermit` (`dropService.ts:370-424`); make **one** claim path, and require `authenticate`
  on it (contrast `routes/drops.ts:68-74`, which has none).
- **Replace** the plaintext personal-sign challenge (`useCreateDrop.ts:534-537`) with the EIP-712
  authorization, so the client does not author a free-form string the server pattern-matches.
- **Add** the private eligibility set behind the declared Resolver, with one declared source per
  campaign; on-chain evidence or a named attestation, with the trust level disclosed (R11).
- **Add** idempotent authorization issuance keyed on the entitlement nullifier, and idempotent
  submission keyed on the authorization.
- **Repair** event indexing for canonical events, and make the database reconcile *from* events
  (R7, I5). The legacy `syncDropsJob` query is unreachable in practice
  (`jobs/syncDropsJob.ts:16-27`), and `ENABLE_EVENT_LISTENER` is declared but unused
  (`config/env.ts:26`).
- **Remove on sight:** every logging site identified in `docs/foundation-audit.md` §2.11 — the
  identity-token log at `middleware/auth.ts:30`, the browser token log at `services/api.ts:69`, and the
  permit-signature (`dropService.ts:605`), relayer-balance (`:609`), transaction-object (`:634`),
  private-identifier (`:331`) and whole-user-record (`authService.ts:20`) logs. Alongside the two token
  logs, the transaction-object and user-record logs matter most: they carry the still-live authorization
  and raw identifiers respectively (R8).

Depends on: Phase A (the nullifier and event shapes it must produce).

### Phase C — Nomine Studio (issuer surface)

- Create and configure a campaign: allocation, budget, eligibility source, opening, expiry, recovery
  destination. Review-before-funding is a required step, not a convenience.
- Fund on Arc; show the confirmed funding transaction.
- Monitor funded, settled, remaining, exhausted, expired, and reclaimed — read from chain, not from a
  status column.
- Reclaim once settlement is no longer possible (expiry reached, or the cap reached), and only then;
  show the reclaimable amount, including any remainder from a non-divisible budget.
- Receipts and explorer references for funding, each settlement, and reclaim.

Depends on: Phases A and B.

### Phase D — Nomine Inbox (claimant surface)

- Authentication, eligibility check, three states only (§3.4), receipts, failure recovery, and the
  disclosure block (issuer, asset, amount, network, Resolver, expiry with timezone, recovery rule).
- "Completed" requires a decodable settlement event (I5, D-004).
- The Claim page must not define success from a relay response (contrast `Claim.tsx:82-89`).
- Also fix the user-visible legacy strings deferred from the landing-page work, since this surface
  replaces them: `pages/Dashboard.tsx:300` ("Recipient claims instantly"), the hardcoded teal glow in
  `components/GiftCard.tsx`, and `link-gift-send/README.md`.

Depends on: Phases A–C for the lifecycle; the design system is already available
(`link-gift-send/src/index.css`, `brand/approved/`).

### Phase E — end-to-end testnet proof

Full matrix in §11 on Arc testnet with deliberately limited value, then §12.

---

## 8. Ownership boundaries and legacy separation

**New campaign and entitlement data.** Introduced as new tables; do not extend `Drop`. The legacy
`Drop` model mixes sender, recipient, escrow, gas tank, status and chain references in one row
(`link-backend/prisma/schema.prisma:32-69`) and is the source of the drift the audit found. New models
separate: campaign configuration, campaign chain facts, entitlement (identity-scoped,
nullifier-bearing), settlement attempt (idempotency key), and canonical event projection.

**Legacy gifts.** `Drop`, `DropEvent`, and `SocialIdentity` records and the legacy `GiftLink` contract
stay exactly as they are. Their custody is not migrated, their links keep working, and no new campaign
logic may read or write legacy escrow. Per D-018 and the issue's non-goals, migration requires an
explicit plan and is not implied by the new work.

**Contract references.** The legacy contract address stays in configuration as-is; the new Claim Core
address is a distinct configuration value with no fallback. Configuration must fail loudly rather than
degrade: the audit found zero-address and `"0x"` fallbacks plus a testnet/mainnet disagreement between
the frontend's own example and its code defaults (`docs/foundation-audit.md` §2.10).

**Links.** New campaigns use `/campaign/:id`; the existing `/claim/:id` contract for legacy gifts is
preserved unchanged. `FRONTEND_URL` must point at a domain the project controls — the current example
value, `https://giftlink.app`, is not established anywhere in this repository as project-controlled
(`link-backend/.env.example:14`).

**ABIs.** One source of truth per contract, generated from the compiled artefact, with a CI check that
the hash matches the deployed bytecode. The legacy `config/abi.ts` is a stale placeholder describing a
different contract generation (`config/abi.ts:2`; audit §2.6) — exactly the failure mode to design out.

---

## 9. Nomine branding on the new surfaces

Apply, do not invent. Studio and Inbox inherit the shared system already in the frontend:

- Approved tokens and self-hosted fonts are wired at `link-gift-send/src/index.css`; the canonical
  assets are served from `/brand/` and verified by `node brand/verify-assets.mjs`.
- Reuse the existing shell (`components/Header.tsx`, `components/Footer.tsx`) and shadcn primitives
  rather than a parallel component library.
- `brand/approved/index.html` is a **design system reference, not a product specification**. Its
  example amounts, identities and dates must not enter live flows, and its static compositions are not
  implementation patterns.
- Name the actual issuer, eligibility verifier, asset, network, expiry with timezone, and recovery rule
  on the surfaces themselves. Violet marks availability and confirmed state, always accompanied by
  wording — never colour or a checkmark alone.
- Do not depict Nomine Inbox or Studio as shipped anywhere they are not. New surfaces ship behind real
  data or they do not ship.
- This is **not** a full legacy makeover. GiftLink by Nomine remains its own focused application with a
  warmer expression; per D-018, a complete makeover is not a prerequisite for V1.

---

## 10. Material open decisions for the product architect

Each item is a **Proposal**, not a settled decision, and none has been recorded in
`docs/DECISIONS.md`. They are separated out because each materially constrains implementation.

| # | Decision | Options | Recommendation | Why it needs the architect |
| --- | --- | --- | --- | --- |
| Q1 | **Eligibility source details** — shape, scoping, and freshness of the declared set | (a) static private allowlist per campaign; (b) hashed allowlist committed on-chain at funding; (c) signed attestation per claimant from a Resolver service | (b) for the proof: a commitment fixed at funding makes the Gate auditable without publishing identities, and needs no new service | Determines whether the Gate is verifiable after the fact, and whether a Resolver can silently change the set |
| Q2 | **Wallet/identity binding and nullifier derivation** | (a) `H(campaignId, identityCommitment)` with a server secret; (b) `H(campaignId, privyId)`; (c) wallet-address-scoped entitlement | (a), with the secret in a dedicated key rather than reusing the legacy `SERVER_PEPPER` commitment scheme | Fixes the uniqueness rule (§6) and the privacy boundary; the wrong choice permits either double settlement or identity linkage |
| Q3 | **Recovery recipient semantics** | (a) always the issuer address; (b) a recovery destination fixed at funding and immutable; (c) a protocol default | (b) — matches "rules fixed when the campaign was created" and survives an issuer key change mid-campaign | Determines whether R6 is enforceable and whether ownership transfer is needed |
| Q4 | **Gas sponsorship model** | (a) keep the existing relayer; (b) Circle Paymaster / App Kit; (c) claimant pays | (a) for the proof, with a per-settlement reimbursement cap (I8), since it already works and R9 only requires that the claimant not handle gas | Affects cost, trust, and whether the relayer becomes a payout authority (audit §2.2) |
| Q5 | **Privacy commitments** — secret management, what is logged, retention | Not a binary choice; a policy is needed | No raw identifier, private eligibility record, or identity token in any log; authorization copies logged only where settlement and reconciliation require them, since the authorization is public calldata once submitted but is still live and single-use before that; commitments derived with a dedicated secret; documented retention | D-008 constrains public logs and on-chain data; the current gaps are in application logs (audit §2.11) |
| Q6 | **Signer powers** — what the coordination signer may authorize | (a) one campaign-scoped signer per campaign; (b) a global signer; (c) threshold or multi-party signing | (a) with rotation for the proof, paired with committing the eligibility set at funding (Q1) so a nullifier belonging to no entitlement is detectable — conditional on the commitment covering the nullifiers and settlement proving membership (§4); (c) if the value at stake justifies it | This is the **only** enforcement of authorization correctness. The contract verifies authenticity, single use, and domain binding, but cannot tell whether the signer chose the right nullifier or wallet (§4). It therefore resolves a residual gap in R4/R5, not just key hygiene |
| Q7 | **Upgradeability and migration** | (a) immutable contract per campaign; (b) upgradeable proxy; (c) immutable plus a successor deployment | (a), matching D-015's rejection of adapters and the "keep the contract small" instruction | Governs whether custody can be changed after funding, which interacts directly with R5 and R6 |

---

## 11. Verification matrix

Every row is a required automated test for the end-to-end testnet implementation.
"Chain-authoritative" means the assertion reads contract state or canonical events, never the
database alone.

| # | Scenario | Expected result | Layer |
| --- | --- | --- | --- |
| 1 | Funded eligible claimant settles | Exactly `allocation` USDC reaches the authorized wallet; one settlement event; entitlement `Settled` | Contract + E2E |
| 2 | Ineligible identity attempts to obtain an authorization | Refused; no authorization issued; no transaction submitted | Coordination |
| 3 | Authorization signed for another chain ID | Rejected by the domain separator | Contract |
| 4 | Authorization signed for another verifying contract | Rejected | Contract |
| 5 | Authorization for another campaign | Rejected | Contract |
| 6 | Authorization naming a different claimant wallet (redirection attempt) | Rejected; no funds move to the third party | Contract |
| 7 | Authorization with an altered amount | Rejected; the transferred amount is always `allocation` | Contract |
| 8 | Authorization with a superseded nonce | Rejected | Contract |
| 9 | Authorization presented after its `deadline` | Rejected | Contract |
| 10 | Replay of a used authorization | Rejected; nullifier already consumed; exactly one settlement | Contract |
| 11 | Duplicate entitlement: same identity obtains a second authorization while unconsumed | Issuance permitted, but only one settlement can land; the second reverts | Contract + Coordination |
| 12 | Settlement before `openingTime` | Rejected | Contract |
| 13 | Settlement exactly at and after `expiryTime` | Rejected | Contract |
| 14 | Reclaim before expiry **and** before the cap is reached, by anyone | Rejected | Contract |
| 15 | Reclaim by a non-issuer after expiry | Rejected | Contract |
| 16 | Reclaim after expiry by the issuer | Exactly `reclaimable` moves to the fixed recovery destination; settled funds untouched; subsequent settlements revert | Contract |
| 17 | Owner/admin attempts to move active escrow | Function does not exist; no path succeeds | Contract |
| 18 | Accounting invariant I2 after an arbitrary sequence of settle/reclaim operations | `funded == settled + remainingUnsettled + remainder` before reclaim and `funded == settled + reclaimed` after, with no unmodelled slack | Invariant test |
| 19 | Retry of a failed settlement with the same authorization | Exactly one settlement row; one on-chain settlement | Coordination |
| 20 | Replaced or dropped transaction retried | Exactly one settlement; no duplicate record or duplicate event projection | Coordination |
| 21 | Re-submission after a timeout where the first attempt actually landed | No second settlement; the service converges on the single on-chain result | Coordination |
| 22 | Database loss with private data protected by backup, then restore: backups first, then canonical-event replay | Financial projections (funded, settled, remaining, reclaimable, reclaimed) and the consumed-nullifier set are rebuilt exactly from events; private eligibility sets, identity mappings, and secret material are restored from protected backups, **not** derived from events; personalized Inbox discovery works again; no resettlement is possible | Recovery |
| 23 | Event stream replayed out of order or duplicated | Projection is idempotent and converges on chain state | Recovery |
| 24 | Budget exhausted, then a further eligible claimant attempts to settle | Rejected; capacity is a hard stop | Contract |
| 25 | Resolver/service unavailable during a claim attempt | No settlement, no false "Completed"; the claimant sees a retryable state | Coordination |
| 26 | Funding transaction reverted | Campaign is not shown as funded or available | Coordination |
| 27 | Privacy assertion | No raw identifier, private eligibility record, or identity token appears on-chain, in public logs, or in API responses. The settlement authorization is **excluded**: it is submitted as public transaction calldata and is on-chain by design. Authorization copies must not be logged beyond what settlement and reconciliation require, and the authenticated authorization-delivery API is explicitly allowed | Privacy |
| 28 | State distinction assertion | An unfunded campaign is never `Available`; an eligible-but-unopened claimant is never shown as settled; `Completed` requires a decodable settlement event | Product + E2E |
| 29 | Budget divisibility boundary: (a) fund a non-multiple of the allocation and settle to the cap; (b) fund an exact multiple and settle to the cap; (c) attempt to fund less than one allocation | (a) `cap == floor(funded / allocation)`, `remainder == funded % allocation` stays in escrow after exhaustion, settlement is refused, reclaim returns exactly `reclaimable`, and `funded == settled + reclaimed` with no stranded balance. (b) `remainder == 0`; reclaim at the cap transfers 0 as a permitted no-op and does not re-enable settlement. (c) Rejected at funding, because `cap >= 1` is required | Contract |
| 30 | Trust boundary: a compromised signer applies its authorized role to a **different wallet** than the claimant selected | **Not prevented on-chain.** The contract cannot detect it, because the wallet is an input to the signed data. Recorded as a trusted-operation assumption with the mitigations in Q6/Q1, not as a passing test. No interface may claim otherwise | Trust boundary (documented, not a pass/fail test) |
| 31 | Trust boundary: a compromised signer issues a second authorization for an entitlement that should not be settleable | **Not prevented on-chain** for the same reason. Single-use still holds once a nullifier is consumed, so the damage is bounded to unconsumed entitlements. Recorded as a trusted-operation assumption with the mitigations in Q6/Q1 | Trust boundary (documented, not a pass/fail test) |

Row 1 is the primary happy path; rows 2–17, 24 and 29 are adversarial or boundary; rows 19–23 are
recovery; rows 30–31 are trust boundaries that must be documented rather than tested, because the
contract cannot enforce them; rows 18 and 25–28 are invariant, failure-path and product-assertion rows.
All are required — the build brief lists ten, and this matrix extends them to cover the failures the
audit found in the legacy system's own claim path and the guarantees the contract cannot provide.

---

## 12. Testnet completion gate

The V1 proof is complete only when all of the following are true and evidenced:

1. The campaign contract is deployed to Arc **testnet** and its deployed bytecode matches the compiled
   source; the address and the deployment transaction are recorded in the repository.
2. Every testable row of §11 passes against that deployment, and the commands to reproduce them are
   committed. Rows 30–31 are documented trust boundaries rather than tests, and must appear in the
   documentation with their mitigations and residual risk stated.
3. A campaign is visibly funded on-chain, and an eligible claimant settles exactly `allocation` to
   their own wallet with a decodable receipt.
4. A duplicate and an unauthorized claim both fail, demonstrated rather than asserted.
5. The issuer view, the claimant Inbox, and chain state agree; any disagreement fails the gate.
6. Once settlement is no longer possible, the reclaimable balance — including any remainder from a
   non-divisible budget — is reclaimed to the fixed recovery destination, and the settled portion is
   untouched. `funded == settled + reclaimed` afterwards, with nothing stranded.
7. The projections that events can reconstruct — funded, settled, remaining, reclaimable, reclaimed, and
   the consumed-nullifier set — can be rebuilt from canonical events, and the private dependencies they
   cannot reconstruct (eligibility set, identity mappings, secret material) have documented protected
   backup and restoration. After both, the projections match chain state and no resettlement is possible.
8. Every logging site identified in `docs/foundation-audit.md` §2.11 is gone: no identity token, raw
   identifier, private eligibility record, or unnecessary authorization copy appears in application logs.
   Authorization copies are retained only where settlement and reconciliation require them, and the
   authenticated authorization-delivery API still works.
9. Configuration has no silent fallbacks: a missing chain ID, RPC URL, contract address, or USDC
   address stops the application rather than defaulting.
10. Reviewer documentation states what is proven and what is not. A passing demo is not an audit.

Arc **mainnet** deployment and any real-fund spending require separate explicit approval (D-014), and
independent review before value limits increase.

---

## 13. What this brief is not

- It is not an implementation. No Claim Core, Resolver, Studio, or Inbox code exists.
- It is not a security audit. The findings in `docs/foundation-audit.md` are static; no runtime was
  exercised, and no mainnet value was at risk or tested.
- It is not a decision record. Section 10 lists proposals; only `docs/DECISIONS.md` holds settled
  choices.
- It is not a roadmap. Features outside the fixed-allocation USDC campaign are out of V1 scope by
  R3, R12 and R13.
