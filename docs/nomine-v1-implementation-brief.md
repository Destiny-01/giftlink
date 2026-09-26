# Nomine V1 Implementation Brief — First Campaign

**Status:** Proposal for review. Defines the first campaign lifecycle and a bounded implementation
sequence. It is **not** an implementation, a deployment, or a security audit, and it does not assert
that any of the described behaviour exists today.

**Authority and precedence:** `docs/PRODUCT.md` governs product meaning, `docs/DECISIONS.md` governs
settled choices, and `docs/build-brief-v1.md` governs current release scope. This brief elaborates
those documents; it never overrides them. Where this brief proposes something not yet settled, it is
labelled **Proposal** and is listed in §10 for the product architect to resolve. Nothing in §10 has
been added to `docs/DECISIONS.md`.

**Superseded by D-019 (September 26, 2026).** `docs/DECISIONS.md` D-019 is now settled and governs the
V1 trust model. Where this brief is incompatible with it, D-019 wins. Concretely, D-019 replaces: the
single-signer assumption and the "the signer is the only enforcement" framing (§4, §6, §10 Q6); the
optional eligibility commitment (§10 Q1) — the commitment over the entitlement identifiers is now
**required**, and settlement proves membership against it; approving-key rotation as a mitigation (§10
Q6) — funded campaigns are immutable and keys cannot be replaced; and the cap/remainder model built on a
possibly larger eligible list (§2, §3.1) — every listed entitlement is now fully funded for its own
allocation, with no oversubscription. §3.4's three Inbox states still hold; the **Awaiting issuer
confirmation** status D-019 adds sits alongside them. Sections below are annotated where D-019 changes
them, and §10 Q1, Q6, Q7 and Q8 are now resolved.

**Prerequisite reading:** `docs/foundation-audit.md` (what exists today), `docs/BRAND.md`,
`brand/IMPLEMENTATION.md`, `brand/approved/GUIDELINES.md`.

---

## 1. Settled requirements this brief must satisfy

These are not open for redesign here. They come from D-002 to D-015, `docs/PRODUCT.md` and
`docs/build-brief-v1.md`.

| # | Requirement | Source |
| --- | --- | --- |
| R1 | Every Claim is fully backed by funded value before it is presented as available | D-002, PRODUCT |
| R2 | One campaign: fixed allocation per claimant, a fully funded entitlement count (no oversubscription), one declared eligibility source, opening and expiry, deterministic issuer reclaim | D-009, build brief, D-019 |
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
| R14 | A settlement requires the claimant's signed wallet selection **and** both an independent issuer attestation and a Nomine Resolver attestation over that exact request; neither authority alone, and no relayer, can settle or redirect it | D-019 |
| R15 | The issuer approval key is held outside Nomine, and the issuer independently verifies the identity-to-wallet assignment through a known channel | D-019 |
| R16 | Every listed entitlement is fully funded for the fixed allocation, with no eligible-list oversubscription; the eligibility commitment is fixed at funding and membership is proven at settlement | D-019 |
| R17 | Funded campaigns are immutable: no upgrades, approving-key replacement, eligibility edits, allocation/time/recovery changes, or early withdrawal | D-019 |
| R18 | Unused funds after expiry are recoverable without claimant consent or either Gate attestation, and losing an approving key cannot strand them | D-019 |

---

## 2. First campaign: scope

The first campaign is the smallest thing that proves the loop. It has exactly one of each variable:

- **One asset:** USDC, native to Arc (R3).
- **One allocation:** a fixed amount per successful claimant, identical for every claimant.
- **One entitlement count, fully funded (D-019):** the issuer fixes the number of listed entitlements at
  funding, and the campaign transfers exactly `allocation × entitlementCount`. Every listed entitlement
  is backed by its own allocation, so there is no cap the eligible list may exceed and no remainder from
  a non-divisible budget. Superseded: the earlier `cap = floor(budget / allocation)` with a settleable
  remainder assumed a list that could be larger than the funded cap.
- **One eligibility commitment (D-019):** a Merkle commitment over the actual entitlement identifiers,
  fixed at funding. Settlement proves membership against it. The earlier brief treated the on-chain
  commitment as optional (Q1); D-019 makes it required.
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

Stored facts: the allocation and entitlement count, `settlementCount`, `openingTime`, `expiryTime`,
the entitlement-identifier commitment, whether the reclaimable balance has been returned, plus
per-identifier consumption. Nothing else is stored. The budget, the settled total, the remaining total
and the reclaimable total are all determined by those facts, and a stored copy of any of them would be
one more value that can disagree with the chain.

Derived, so that no separate stored value can disagree with the facts (D-019 removed the cap and the
remainder by funding every listed entitlement):

- `budget = allocation × entitlementCount` — transferred in full at funding
- `settledAmount = settlementCount × allocation` — exact, because every settlement transfers exactly
  `allocation` (I3)
- `remainingUnsettled = (entitlementCount − settlementCount) × allocation`
- `reclaimable = budget − settledAmount` — the amount the issuer is entitled to receive **at reclaim**,
  not the escrow balance once a reclaim has happened
- `escrowBalance = budget − settledAmount − reclaimedAmount` — what the contract actually holds.
  Before reclaim this equals `reclaimable`; after reclaim it is `0`
- `reclaimedAmount` = the `reclaimable` value at the moment reclaim executed, fixed thereafter

The escrow balance and the cumulative `budget − settledAmount` are different quantities and must
not be conflated: after a reclaim the first is zero while the second stays non-zero for the rest of the
campaign's life.

The reclaim flag is the one piece of state that cannot be derived: when every entitlement is settled, a
fully settled campaign and a reclaimed one both hold nothing, so the contract must record that reclaim
happened rather than infer it.

Funding requires `entitlementCount >= 1` and `allocation > 0`, so a campaign is never created unable to
settle anything. (D-019 replaced the old `fundedAmount >= allocation` / `cap >= 1` guard, which existed
only because the cap was derived from a possibly non-divisible budget.)

Derived campaign phase:

| Phase | Predicate | Escrow held |
| --- | --- | --- |
| `Unfunded` | `fundedAmount == 0` | none |
| `Funded, not yet open` | funded, `now < openingTime` | entire budget |
| `Open` | funded, `openingTime <= now < expiryTime`, `settlementCount < entitlementCount` | `escrowBalance` |
| `Exhausted` | funded, `settlementCount == entitlementCount`, not reclaimed | 0 |
| `Expired` | `now >= expiryTime`, not reclaimed | `escrowBalance` |
| `Reclaimed` | the reclaimable balance has been returned per the recovery rule | 0 |

The escrow column is the contract's actual balance (`escrowBalance`), not the cumulative
`fundedAmount − settledAmount`, which stays non-zero after a reclaim.

Settlement is permitted **only** while all three hold: funded, `openingTime <= now < expiryTime`, and
`settlementCount < entitlementCount`.

Reclaim is permitted **only** at or after expiry — `now >= expiryTime` — and only by the issuer, and
transfers exactly `reclaimable = budget − settledAmount`, which is every allocation that was never
settled. It never touches the settled portion.

Reclaim is deliberately **not** triggered by exhaustion. A campaign that reaches its entitlement count
before expiry does not open an earlier recovery path; reclaim stays expiry-only, and Q8 is resolved as
expiry-only. Because every entitlement is fully funded, an exhausted campaign's escrow is exactly zero,
but `Exhausted` and `Expired` are still not mutually exclusive: the phase is derived from facts plus the
clock.

Because the phase is derived, it cannot drift: there is no transition to forget, no job required to
notice an expiry, and no state a permissionless caller can grief. Note this is a deliberate correction
of the `markExpired` deadlock in the legacy contract (`GiftLink.sol:290-295` versus `:332-338`), where
a third party can permanently block the sender's only refund path.

### 3.2 Entitlement lifecycle (per eligible identity, per campaign)

| State | Meaning | Exits |
| --- | --- | --- |
| `NotEligible` | identity is not in the declared set | — |
| `Eligible` | Resolver confirms membership; entitlement not yet consumed | → `Authorized` |
| `ConfirmationPending` | the claimant has signed the payout; one or both attestations are still outstanding | → `Authorized`, or expiry/rejection → `Eligible` |
| `Authorized` | the claimant's signed request and both attestations are complete and unexpired | → `Settled`, or expiry → `Eligible` |
| `SettlementPending` | a settlement transaction is submitted and unconfirmed | → `Settled`, or failure → `Eligible` |
| `Settled` | nullifier consumed on-chain (terminal) | — |

The `Authorized → Eligible` exit is the retry path: an authorization that expires, or that fails
against a reverted transaction, may be replaced by a fresh authorization **for the same entitlement**.
Only `Settled` is terminal, and only the chain can reach it.

### 3.3 Transaction workflow (off-chain machinery)

Distinct from the on-chain lifecycle, and where the audit's most serious defects live.

```
claimant authenticates (Privy identity token)
  → interface discloses the confirmation requirement, and the claimant signs the payout they are
    requesting (campaign, entitlement, wallet, amount, chain, contract, deadline)
  → Resolver: is this identity in the declared set, and is the entitlement unconsumed?
  → issuer approver independently verifies the identity-to-wallet assignment through a known channel
  → coordination service assembles the claimant's consent plus both attestations (idempotent per
    entitlement); while either is outstanding the surface shows **Awaiting issuer confirmation**
  → sponsored settlement submitted to Arc
  → chain verifies consent, both attestations, membership and consumption, then settles USDC directly
    to the wallet the claimant signed for
  → receipt verified by decoding the canonical event, not by trusting a supplied hash
  → campaign and entitlement projections updated from that event
```

Failure and retry rules:

- **Authorization assembly is idempotent per entitlement.** Re-requesting before settlement returns the
  same in-progress request rather than creating a second entitlement.
- **A pending approval is not a settlement.** While the issuer approver or the Resolver has not attested,
  nothing is submitted and the surface shows **Awaiting issuer confirmation**; expiry still applies to the
  request while it is pending.
- **Submission is idempotent per authorization.** A retry with the same authorization must not produce
  a second settlement; the on-chain identifier consumption is the backstop, not the service's memory.
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
| **Available** | the claim is funded and addressed to this viewer, and this entitlement is unsettled with settlement still possible — `Eligible`, `ConfirmationPending`, `Authorized`, or `SettlementPending` | show issuer, amount, asset, network, eligibility verifier, expiry **with timezone**, recovery rule; while an approval is outstanding show **Awaiting issuer confirmation** as a workflow status; for `SettlementPending`, show the submitted transaction as unconfirmed and never as `Completed` (§3.3) |
| **Completed** | entitlement `Settled` on-chain, receipt decodable | show settled amount and the transaction reference |
| **Expired** | this entitlement will never settle because the campaign's declared expiry passed with it unsettled | state the expiry and that unused capital returns under the recovery rule fixed at funding |

**The boundary presentation is proposed, not settled (Q9).** Two cases fall outside what the settled
sources decide: what a claimant sees **before an unopened campaign opens**, and what they see **after an
exhausted campaign reaches its entitlement count before expiry**. What *is* settled about both: settlement is refused,
reclaim remains expiry-only, and there are exactly three states. Which label carries each window is
material product semantics — it changes what "Available" and "Expired" mean to a claimant — so this brief
does not prescribe it. The proposal under Q9 is to present the pre-opening claim as `Available` with the
opening time stated, and the post-exhaustion claim as `Expired` with fully-allocated copy. §3.5 is written
on that basis and marks those two cells as proposed. Q9 must be resolved in `docs/DECISIONS.md` before the
Inbox boundary presentation is implemented (§7 Phase D, §12 item 12). The proposal in (a) introduces no
fourth state; option (c) would require R10 itself to be revisited, which is precisely why it is a product
decision rather than an implementation detail.

`Available` is a lifecycle state, not a claim that the viewer personally qualifies. A funded campaign
the viewer is not part of is not shown in their Inbox at all.

### 3.5 Boundary behaviours (no fourth state required)

| Situation | Behaviour | Why it does not add a state |
| --- | --- | --- |
| Before opening (`Funded, not yet open`) | **Settled:** settlement is refused until opening. **Proposal (Q9):** the claim is presented as `Available` with the opening time stated. | Either way this is a time-gate on the action, not a fourth state |
| After budget exhaustion (`Exhausted`) | **Settled:** settlement is refused, this entitlement can no longer settle, and the escrow is empty until expiry, when the reclaim returns any unsettled balance under the fixed recovery rule. **Proposal (Q9):** remaining eligible identities are presented as `Expired` with fully-allocated copy. | Either way no fourth state is required; which label carries it is the open question, not the behaviour |
| Between exhaustion and expiry | Nothing is offered; no queue, no waitlist, no partial allocation | R2/R3 forbid partial settlement |
| After expiry, unsettled | `Expired` with the recovery statement | Terminal |
| After reclaim | Nothing offered | Reclaim is an issuer-side fact, not a claimant state |

---

## 4. Trust boundaries

| Actor | May | May **not** | Enforced where |
| --- | --- | --- | --- |
| Issuer | create a campaign, fund it, reclaim the unused balance after expiry under the fixed rule | withdraw active escrow, change allocation/entitlement count/opening/expiry/recovery after funding, redirect a settlement | contract (R5, R6, R17) |
| Issuer approver (independent key) | attest the identity-to-wallet assignment after verifying it through a known channel | attest without independent verification, or act as the sole approver | off-chain procedure; the contract requires it alongside the Resolver, and the key is held outside Nomine (R14, R15) |
| Resolver / eligibility verifier | assert membership of a declared identity in the declared set, for a named campaign, within a validity window | move funds, choose the settlement amount, redirect settlement, consume an entitlement, settle alone | off-chain assertion; the contract requires the campaign's declared Resolver **and** the declared issuer approver to attest the same signed request (R5, R11, R14) |
| Coordination service / backend signer | assemble the claimant's signed request and both attestations, and sponsor submission | alter an approved payout, settle without both attestations, or redirect the wallet | contract binds the payout to the claimant's consent and both attestations; the service cannot select or replace the wallet |
| Relayer | submit a valid, fully attested request and receive a defined, capped reimbursement | choose the recipient, alter the amount, submit without both attestations | contract (R5) |
| Claimant | authenticate, prove eligibility, sign their selected wallet, settle once to their own wallet | settle twice, settle for another identity, settle outside the window, be paid to an address other than the one they signed | contract identifier consumption + consent and attestation binding (R4, R14) |
| Anyone | read public state and events | — | — |

**Approval correctness and its limits (D-019).** Two independent authorities must attest, and the
contract requires both signatures to recover to the campaign's distinct issuer approver and Resolver.
The claimant's own signature over the payout wallet is a third, separate check. Changing the amount,
retargeting the wallet, moving the request to another campaign, chain, or contract, or extending the
deadline is prevented on-chain: all of those fields are bound by the claimant's consent and by both
attestations.

The contract still cannot prove that an approval was justified. It cannot verify that an entitlement
identifier corresponds to an off-chain identity, and it cannot verify who controls either authority key.
Wallet consent proves control of the wallet, not ownership of the identity behind the entitlement. A
fixed membership commitment narrows the fabrication surface — an entitlement not in the commitment
cannot settle at all — but it cannot stop a colluding pair of authorities from assigning an **unused**
entitlement to a wallet they control and signing as that wallet.

So the honest statement is: **custody and payout integrity are enforced by the contract; the
justification for each approval is enforced by the two authorities jointly.** No interface may present an
attested fact as identity verification. The residual risk is exactly the collusion risk recorded in
D-006: it is bounded by remaining campaign capacity, not eliminated, and rows 30–31 of §11 record it as
a documented trust boundary rather than a passing test.

**Off-chain eligibility is attested, not trustless.** The interface names the Resolver. The system
never describes a Resolver-attested fact as cryptographically proven, and never presents a checkmark
as standing for identity, funding, and security at once (R11, D-005).

---

## 5. Accounting invariants

Must hold at all times, and must be asserted by tests rather than assumed:

- **I1 — Full backing:** before reclaim, `escrowBalance >= (entitlementCount − settlementCount) × allocation`.
  Every settlement that can still occur is already funded, with no gap: every listed entitlement has its
  own allocation, so unlike the superseded cap/remainder model there is no residual difference to explain.
  `budget − settledAmount` is the amount the issuer is entitled to reclaim; it equals the escrow balance
  before reclaim and diverges from it permanently once a reclaim has occurred.
- **I2 — Conservation, exactly:** before reclaim, `escrowBalance == remainingUnsettled`; after reclaim,
  `escrowBalance == 0` and `budget == settledAmount + reclaimedAmount`. Both forms must hold with no
  unmodelled slack: any fee must be an explicit term.
- **I3 — Fixed allocation:** every settlement transfers exactly `allocation`; there is no path that
  transfers another amount, and no path that settles a partial allocation.
- **I4 — Entitlement count:** `settlementCount <= entitlementCount`. Reaching the count is a hard stop on
  settlement: because every entitlement is fully funded, the escrow is then empty until the reclaim at
  expiry (which returns the unsettled balance, zero in that case).
- **I5 — Single settlement per entitlement:** the set of consumed identifiers has no duplicates, and
  `settlementCount == |consumed identifiers|`.
- **I6 — No sweep:** no issuer, owner, admin, Resolver, or relayer action can reduce the escrow before
  expiry, or move anything other than `reclaimable` at reclaim.
- **I7 — Reclaim is bounded and exact:** reclaim transfers exactly
  `reclaimable = budget − settledAmount` as evaluated at that moment; afterwards
  `escrowBalance == 0`, `budget == settledAmount + reclaimedAmount`, and no further settlement is
  possible.
- **I8 — Reimbursement is bounded:** relayer compensation is capped per settlement and cannot scale
  with campaign value (contrast the legacy gas tank, which is a per-drop balance the relayer receives
  in full — `GiftLink.sol:249-254`).

The legacy system holds none of I1, I4, I5 or I6, and exposes I2 to `emergencyWithdrawUSDC()`
(`GiftLink.sol:410-413`). This is why the custody contract is a *replace*, not a *repair*
(`docs/foundation-audit.md` §3).

---

## 6. Entitlement uniqueness

The rule: **one entitlement per eligible identity per campaign, settleable exactly once.**

Key derivation (**D-019**: the identifier is high-entropy and campaign-specific, and the set is
committed at funding):

```
entitlementId = H(campaignId, identityCommitment, campaignSalt)
```

The entitlement identifier **is** the nullifier: consuming it is what prevents reuse.

- `identityCommitment` is derived from the normalized identity using a server-held secret, and is
  never published raw (R8).
- The nullifier is **not** derived from the authorization signature. This is the specific defence the
  issue requires: a re-issued signature for the same entitlement must not create a second settlement.
  Uniqueness lives in the identity, and the contract consumes the nullifier.

**What this rule is enforced by (D-019).** The contract enforces two things: one settlement per consumed
identifier (I5), and membership of that identifier in the commitment fixed at funding. A fabricated
identifier — one that belongs to no listed entitlement — cannot settle at all, because the membership
proof fails. The contract still cannot enforce *identity* uniqueness: the mapping from an identity to its
identifier is computed off-chain, and the contract never sees an identity, only the identifier it is
handed. "One entitlement per eligible identity per campaign" therefore rests on the issuer approver and
the Resolver attesting the correct identifier. The residual exposure is the collusion risk in §4: two
colluding authorities can assign an **unused** identifier to a wallet they control. The per-identifier
guarantee holds throughout; the per-identity guarantee does not.

Consequences that must be explicitly handled:

| Scenario | Required behaviour |
| --- | --- |
| Claimant retries after a failed or reverted transaction | Fresh authorization for the **same** entitlement; nullifier still unconsumed; exactly one settlement eventually lands |
| Authorization expires unused | A new authorization may be issued for the same entitlement; the expired one must be unusable |
| Claimant changes wallet before settling | A new signed request may name the new wallet, because the entitlement is per identity, not per wallet. **(Superseded by D-019):** the contract keeps no per-request nonce, so an old signed request stays submittable by anyone holding it until the entitlement is consumed or the campaign expires. Changing wallets is therefore coordinated in the pending-confirmation workflow — the issuer approver and Resolver attest only the new request, and the old one is not invalidated on-chain. The payout destination is always the wallet that request's claimant signed (R4) |
| Same identity appears twice in the eligibility set | Must be de-duplicated by the Resolver at admission, and must still yield one nullifier |
| Two different identities resolve to the same wallet | Both may be entitled; each settles once to that wallet. Never merges entitlements |
| Cross-campaign | The same identity may settle once in each campaign; the nullifier is campaign-scoped |
| Chain/DB divergence after interruption | The consumed-nullifier set and the financial projections are rebuilt from canonical events; a database that lost the record must not permit a resettlement. Private eligibility data, identity mappings, and secret material are **not** reconstructible from events and must be restored from protected backups first (§11 row 22, §12 item 7) |

The legacy system fails this requirement structurally: uniqueness rests on the drop's status
transition (`GiftLink.sol:229,244`) with no identity-scoped nullifier, and the database records
settlement from a client-supplied hash (`dropService.ts:697-703`).

---

## 7. Implementation sequence

Bounded, each phase gated on the previous, with one deliberate exception noted below. Phases A–D are the
minimum for the proof. The sequence deliberately puts correctness before surface: the audit found that
the correct eligibility logic already exists but is wired to an unused path
(`dropService.ts:370-424` versus `:501-583`), so **re-pointing the live claim path at strict verification
is the first correctness win, and it can precede the new contract.** That one repair is the exception to
the phase gating: it may ship before Phase A. Everything else depends on the phase before it.

### Phase A — Claim Core (contract + tests)

Build the minimal contract defined in the build brief. Deliverables:

- Campaign struct holding: issuer, USDC asset, allocation, entitlement count, entitlement commitment,
  declared issuer approver, declared Resolver, opening time, expiry time, **recovery destination**,
  settlement count, and a reclaim flag. The recovery destination is stored explicitly rather than assumed
  to be the issuer; the pilot uses the issuer address (D-019). The derived totals (`budget`, `settled`,
  `remaining`, `reclaimable`) are computed exactly as in §3.1, so none of them is a stored field.
  Funding requires `allocation > 0` and `entitlementCount >= 1` (§3.1).
- `settle(claimRequest, claimantSignature, approval, issuerApprovalSignature, resolverApprovalSignature,
  entitlementProof)` with EIP-712 domain separation, a membership proof against the committed identifier
  set, identifier consumption before transfer, and a fixed `allocation` transfer directly to the wallet
  the claimant signed for.
- `reclaim()` callable by the issuer only, and only at or after `expiryTime`, transferring exactly
  `reclaimable = budget − settledAmount` to the recovery destination fixed at funding. Exhaustion does
  not open an earlier path, and reclaim needs neither Gate attestation nor claimant consent.
- Canonical events: campaign created, funded, settled, reclaimed. There is deliberately no
  `reclaim-enabled` event: expiry is a fact fixed at funding, and the clock passing it creates no
  transition to emit.
- **No owner sweep function at all.** The absence is the guarantee (R5).

Depends on: nothing technically — this is the root dependency for everything else. **Q6 is now resolved
by D-019**: settlement requires the claimant's consent plus both an independent issuer approver and the
Resolver, and funded campaigns are immutable. The contract does not enforce the *justification* for an
approval (§4), so the residual collusion exposure is documented rather than claimed away.

Testing gate: every §11 row whose Layer is `Contract` or `Invariant test` — including row 24, and
excluding the Coordination-only rows such as row 2 — must pass in unit tests before Phase B begins.
The coordination rows are exercised in Phase B, not here.

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

Depends on: Phase A for the nullifier and event shapes it must consume — except the strict-verification
re-point of the legacy claim path, which needs nothing from the new contract and may ship first (§7).

### Phase C — Nomine Studio (issuer surface)

- Create and configure a campaign: allocation, budget, eligibility source, opening, expiry, recovery
  destination. Review-before-funding is a required step, not a convenience.
- Fund on Arc; show the confirmed funding transaction.
- Monitor funded, settled, remaining, exhausted, expired, and reclaimed — read from chain, not from a
  status column.
- Reclaim after expiry, and only then; show the reclaimable amount and never offer it before expiry even
  when the campaign is exhausted (Q8).
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
(`link-gift-send/src/index.css`, `brand/approved/`). **Q9 must be resolved before the boundary
presentation is implemented** — the settled parts (three states, settlement refused before opening and
after exhaustion) can be built without it, but which label carries each window cannot (§3.4, §10).

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
| Q1 | **Eligibility source details** — shape, scoping, and freshness of the declared set | **(Resolved by D-019):** the entitlement-identifier commitment is fixed on-chain at funding, and settlement proves membership against it | Resolved | The commitment over the actual identifiers is now required, not optional; it makes the Gate verifiable after the fact and prevents an unlisted identifier from settling |
| Q2 | **Wallet/identity binding and identifier derivation** | (a) `H(campaignId, identityCommitment, campaignSalt)` with a server secret; (b) `H(campaignId, privyId)`; (c) wallet-address-scoped entitlement | (a), with the secret in a dedicated key rather than reusing the legacy `SERVER_PEPPER` commitment scheme; **D-019** requires the identifier to be high-entropy and campaign-specific, with the set committed at funding | Fixes the uniqueness rule (§6) and the privacy boundary; the wrong choice permits either double settlement or identity linkage |
| Q3 | **Recovery recipient semantics** | (a) always the issuer address; (b) a recovery destination fixed at funding and immutable; (c) a protocol default | (b) — matches "rules fixed when the campaign was created"; the pilot uses the issuer address (**D-019**) | Determines whether R6 is enforceable; funded campaigns are immutable, so the destination cannot change after funding |
| Q4 | **Gas sponsorship model** | (a) keep the existing relayer; (b) Circle Paymaster / App Kit; (c) claimant pays | (a) for the proof, with a per-settlement reimbursement cap (I8), since it already works and R9 only requires that the claimant not handle gas | Affects cost, trust, and whether the relayer becomes a payout authority (audit §2.2) |
| Q5 | **Privacy commitments** — secret management, what is logged, retention | Not a binary choice; a policy is needed | No raw identifier, private eligibility record, or identity token in any log; authorization copies logged only where settlement and reconciliation require them, since the authorization is public calldata once submitted but is still live and single-use before that; commitments derived with a dedicated secret; documented retention | D-008 constrains public logs and on-chain data; the current gaps are in application logs (audit §2.11) |
| Q6 | **Signer powers** — what the coordination signer may authorize | **(Resolved by D-019):** no single signer. Each settlement requires the claimant's consent plus both an independent issuer approver and the Resolver over the same signed request | Resolved | Rotation is no longer a mitigation: funded campaigns are immutable and approving keys cannot be replaced. Losing a key stops settlement until expiry but never strands recovery (R18) |
| Q7 | **Upgradeability and migration** | **(Resolved by D-019):** an immutable contract, with no proxy and no authority or approving-key replacement | Resolved | D-019 makes funded campaigns immutable, so the rotation question is settled: custody cannot change after funding |
| Q8 | **Early release after exhaustion** | **(Resolved by D-019 / this brief):** reclaim stays expiry-only | Resolved | D-019 fixes reclaim at expiry. With every entitlement fully funded there is no remainder, so exhaustion leaves an empty escrow and no earlier recovery path is needed |
| Q9 | **Boundary presentation in the Inbox** — which of the three states carries a claim **before opening**, and which carries one **after an exhausted cap** | (a) `Available` with the opening time before opening, and `Expired` with fully-allocated copy after exhaustion — the proposal in §3.4; (b) the same two labels with different copy; (c) a distinct presentation for each window, which would require a product decision about R10's three states | (a) for the proof: it keeps the settled three states and needs no new surface | These labels are what a claimant reads to judge whether they can still be paid, so the mapping changes what `Available` and `Expired` mean. D-009 and the build brief settle *that* there are three states and *that* settlement is refused in both windows; they do not settle which label carries each, so it cannot enter the specification silently. Blocks Phase D's boundary presentation (§7, §12 item 12) |

---

## 11. Verification matrix

Every row is required. Rows 30–31 are documented trust boundaries rather than automated tests; all the
rest are automated against the end-to-end testnet implementation. "Chain-authoritative" means the
assertion reads contract state or canonical events, never the database alone.

| # | Scenario | Expected result | Layer |
| --- | --- | --- | --- |
| 1 | Funded eligible claimant settles | Exactly `allocation` USDC reaches the authorized wallet; one settlement event; entitlement `Settled` | Contract + E2E |
| 2 | Ineligible identity attempts to obtain an authorization | Refused; no authorization issued; no transaction submitted | Coordination |
| 3 | Authorization signed for another chain ID | Rejected by the domain separator | Contract |
| 4 | Authorization signed for another verifying contract | Rejected | Contract |
| 5 | Authorization for another campaign | Rejected | Contract |
| 6 | Authorization naming a different claimant wallet (redirection attempt) | Rejected; no funds move to the third party | Contract |
| 7 | Authorization with an altered amount | Rejected; the transferred amount is always `allocation` | Contract |
| 8 | **(Superseded by D-019)** Superseded-nonce authorization: the contract keeps no per-request nonce, so a previously signed request remains valid until its entitlement is consumed or the campaign expires. Wallet changes are handled by attesting only the new request in the pending-confirmation workflow, not by invalidating the old one on-chain | Contract |
| 9 | Authorization presented after its `deadline` | Rejected | Contract |
| 10 | Replay of a used authorization | Rejected; nullifier already consumed; exactly one settlement | Contract |
| 11 | Duplicate entitlement: same identity obtains a second authorization while unconsumed | Issuance permitted, but only one settlement can land; the second reverts | Contract + Coordination |
| 12 | Settlement before `openingTime` | Rejected | Contract |
| 13 | Settlement exactly at and after `expiryTime` | Rejected | Contract |
| 14 | Reclaim before expiry, by anyone — including a campaign that has already reached its entitlement count | Rejected; exhaustion does not open an earlier recovery path | Contract |
| 15 | Reclaim by a non-issuer after expiry | Rejected | Contract |
| 16 | Reclaim after expiry by the issuer | Exactly `reclaimable` moves to the fixed recovery destination; settled funds untouched; subsequent settlements revert | Contract |
| 17 | Owner/admin attempts to move active escrow | Function does not exist; no path succeeds | Contract |
| 18 | Accounting invariants I1/I2 after an arbitrary sequence of settle/reclaim operations | Before reclaim `escrowBalance == remainingUnsettled == (entitlementCount − settlementCount) × allocation`; after reclaim `escrowBalance == 0` while `budget == settled + reclaimed`. The escrow balance and the cumulative `budget − settled` are asserted separately and never conflated | Invariant test |
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
| 29 | **(Superseded by D-019)** Budget divisibility: no longer applicable. Every listed entitlement is fully funded, so there is no cap to derive and no remainder to strand. Replaced by the full-funding and conservation checks in rows 1, 16, 18 and 24 | Contract |
| 30 | Trust boundary: both Gate authorities collude to assign an **unused** entitlement to a wallet they control and sign as that wallet | **Not prevented on-chain**, and not preventable by a fixed commitment: the wallet consent would come from a wallet they control, and both attestations would be authentic. This is the D-006 collusion risk and must be documented, never described as identity verification | Trust boundary (documented, not a pass/fail test) |
| 31 | Trust boundary: either authority is compromised, or its key is lost | **Neither alone can settle**, because the other authority's attestation is still required. A lost or compromised key stops settlement until expiry — it cannot be replaced, because funded campaigns are immutable — but never strands funds: `reclaim` needs neither attestation nor consent (R18) | Trust boundary (documented, not a pass/fail test) |

Row 1 is the primary happy path; rows 2–17 and 24 are adversarial or boundary; rows 19–23 are
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
6. After expiry, the reclaimable balance is reclaimed to the fixed recovery destination, and the settled
   portion is untouched. `escrowBalance == 0` and `budget == settled + reclaimed` afterwards, with nothing
   stranded. Reclaim before expiry was rejected, including for a campaign that had reached its entitlement
   count.
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
11. Authorization correctness rests on the recorded mechanism rather than an undisclosed single signer:
    **D-019 supersedes Q6**, the deployed mechanism matches that record (claimant consent plus both
    independent attestations), and the residual collusion exposure is stated in the reviewer
    documentation (§4, §6).
12. The Inbox's boundary presentation follows a resolved **Q9** record: claims before opening and claims
    in an exhausted campaign are presented as the architect decided, the three states are unchanged unless
    R10 is amended by that same decision, and settlement is refused in both windows (§3.4).

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
