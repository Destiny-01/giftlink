# GiftLink Foundation Audit

**Status:** Audit artefact for chief-engineer review. This document describes what exists today.
It does **not** assert that a Claim campaign flow, Nomine Inbox, or Nomine Studio has been built.

**Authority:** Product meaning is governed by `docs/PRODUCT.md`; settled choices by
`docs/DECISIONS.md`; release scope by `docs/build-brief-v1.md`. Where this audit disagrees with
those documents, they win. This audit does not create new durable decisions.

## How this audit was produced

Static analysis of the repository at commit `7eb23d6` (branch
`docs/3-nomine-foundation-audit-and-brief`), by reading source files. Citations are
`path:line` against that commit.

**No runtime behaviour was exercised.** No database, RPC endpoint, Privy application, relayer, or
deployment was contacted, and no private keys, tokens, or pepper values were read.
`link-backend/.env` was deliberately not opened because it holds signer keys and `SERVER_PEPPER`.
Every finding below is therefore either **Confirmed** (the code says so) or a bounded static
inference; nothing here is a demonstrated exploit.

### Confidence legend

| Level | Meaning |
| --- | --- |
| **Confirmed** | Directly readable in source. No runtime needed. |
| **Assumption** | A bounded inference from code that depends on runtime or deployment state. |
| **Unknown** | Cannot be established from the repository at all. |

---

## 1. Current end-to-end flow map

### 1.1 Identity and session

| Step | Evidence |
| --- | --- |
| Frontend obtains a Privy identity token | `link-gift-send/src/hooks/useAuth.ts:51,58` |
| Every API call carries `Authorization: Bearer <identityToken>` | `link-gift-send/src/services/api.ts:62-77` |
| Backend extracts the bearer token | `link-backend/src/middleware/auth.ts:19-30` |
| User is upserted from Privy `linkedAccounts` | `authService.ts:28-60` |
| Identity fields extracted | `authService.ts:83-146` |
| Persisted | `link-backend/prisma/schema.prisma:13-30` |

The identity token is the sole authentication credential. `optionalAuthenticate` exists for read
paths and never fails a request: it swallows every error and calls `next()`
(`middleware/auth.ts:60-97`).

### 1.2 Wallet binding

Wallet binding is **server-derived, not client-asserted**, which is the right shape to retain.

- The frontend does send a wallet address (`services/api.ts:107-110`,
  `{ authToken, walletAddress }`), but the accepted schema declares only `authToken`
  (`link-backend/src/dto/user.dto.ts`, `privyAuthSchema`), so Zod strips the extra key.
- The authoritative address comes from Privy's `linkedAccounts`
  (`authService.ts:95-105`), lower-cased at `authService.ts:98-100`.

**Confirmed.** The duplicated client-sent `walletAddress` is dead payload and should be deleted; it
invites a future reader to assume it is trusted.

### 1.3 Create and fund

1. The client builds the create payload, including a locally computed `expiry` and the claimed
   `fundingSource`/`senderAddress` (`link-gift-send/src/pages/Create.tsx:227-240`).
2. `POST /api/drops/prepare` → `prepareDrop` writes a `PENDING` Drop with `recipientCommit`,
   `gasTankAmount`, and `estimatedGasCost` (`dropService.ts:155-257`, status at `:230`;
   route: `link-backend/src/routes/drops.ts:36-42`).
3. The client approves USDC for `amount + gasTankAmount`, calls `createDrop(...)`, and waits for a
   receipt, rejecting `reverted` (`link-gift-send/src/hooks/useCreateDrop.ts:150-270`).
4. `POST /api/drops/confirm` → `confirmDrop` sets `onchainId`, `creationTxHash`, and
   `status = ACTIVE` (`dropService.ts:261-306`, status at `:294`; route: `drops.ts:44-50`).

Ownership on confirm is checked against the server-derived `senderPrivyId`
(`dropService.ts:271-274`) — good. But **`confirmDrop` never verifies the transaction**: it accepts
the client's `onchainId` and `txHash` verbatim and never calls `getTransactionReceipt` or decodes
`DropCreated`. **Confirmed.**

### 1.4 Eligibility

Eligibility is computed once, as a UI hint, by `getDropDetails` (`dropService.ts:309-343`):
`canClaim = isPublicDrop` for public drops, otherwise it resolves the recipient's `privyId` by
identifier and compares it to the caller. The logging line `dropService.ts:331` writes both private
IDs to the log.

Nothing downstream depends on `canClaim`. The claim paths recompute their own checks, and for three
of the five recipient types those checks are empty (§2.2).

### 1.5 Authorization and signing

- EIP-712 domain `{ name, version, chainId, verifyingContract }`
  (`link-backend/src/utils/eip712.ts:3-12`), defaults `GiftLinkPermit`/`1` from env
  (`link-backend/src/config/env.ts:24-25`).
- Permit type: `ClaimPermit(uint256 dropId, address claimer, uint64 expiry)`
  (`utils/eip712.ts:14-20`) — the same typehash the contract declares
  (`link-backend/contracts/GiftLink.sol:31-32`).
- Permits are signed by `backendSigner` with a fixed **1 hour** TTL
  (`dropService.ts:456-467` and `:586-600`; TTL constants at `:463` and `:593`).
- The contract recovers the signer and requires it to equal `backendSigner`
  (`GiftLink.sol:232-241`).

The domain separator binds chain ID and verifying contract, and the drop's `status` leaves `ACTIVE`
before transfer (`GiftLink.sol:244`), so cross-context replay and same-drop replay are both blocked
at the contract level. There is **no nonce/nullifier** in the permit type; uniqueness relies entirely
on the drop's own status.

### 1.6 Claim — the path that actually runs

The deployed claim path is **not** the permit endpoint. It is `relayClaim`:

1. The client signs a **plaintext** message with `personal_sign`
   (`link-gift-send/src/hooks/useCreateDrop.ts:534-537`):
   `GiftLink Claim Authorization\nDrop ID: <onchainId>\nClaimer: <address>\nTimestamp: <ts>`.
2. `POST /api/drops/:id/relay-claim` — **mounted without `authenticate`**
   (`link-backend/src/routes/drops.ts:68-74`).
3. `relayClaim` (a) enforces a 5-minute timestamp window (`dropService.ts:531-540`), (b) recovers the
   signer from the plaintext message and requires it to equal the supplied `claimer`
   (`dropService.ts:549-556`), (c) signs an EIP-712 permit for that `claimer` (`:586-600`),
   (d) sends `claimWithPermit` from the relayer wallet (`:617-643`), and (e) returns the receipt hash.

The relayer, not the claimant, submits the transaction. `claimWithPermit` pays the claimer and
reimburses the relayer from the drop's gas tank in the same call (`GiftLink.sol:249-254`).

### 1.7 Confirmation and recording

- The client treats a returned `txHash` as success and sets local state **optimistically**
  (`link-gift-send/src/pages/Claim.tsx:82-89`, `setClaimed(true)` at `:83`), then refetches backend
  state.
- `POST /api/drops/:id/claimed` → `recordDropClaim` requires a receipt with `status === 1`
  (`dropService.ts:697-703`) before flipping to `CLAIMED` (`:713`), and returns early if already
  claimed (`recordDropClaim`, `dropService.ts:675-735`).
- It never decodes the receipt's logs, so it cannot tell whether the accepted hash is this drop's
  `claimWithPermit`. **Confirmed** (§2.5).

### 1.8 Expiry

- `expireDropsJob` runs hourly and flips `ACTIVE → EXPIRED` in the **database only**
  (`link-backend/src/jobs/expireDropsJob.ts:6-52`; filter at `:11`, write at `:36`).
- The contract enforces its own `expiry` at claim time
  (`GiftLink.sol:147-150,229-230,265-266`).
- `markExpired` exists on-chain (`GiftLink.sol:332-338`) but **no code in this repository ever calls
  it**; it appears only inside the ABI (`link-backend/src/config/abi.ts:647`).

### 1.9 Revocation and return of funds

- On-chain `revokeDrop` is sender-only, `onlyActive`, and refunds `amount + gasTankAmount` to the
  sender (`GiftLink.sol:290-305`).
- The backend `recordDropRevocation` looks the drop up by **`onchainId`**
  (`dropService.ts:742-744`), matching the frontend, which passes the on-chain id
  (`link-gift-send/src/components/GiftCard.tsx:156` → `hooks/useArcClient.ts:259`). This route is
  the only `:id` route without `validateParams` (`drops.ts:94-100`), which is why the non-UUID value
  survives — an inconsistency to make explicit rather than leave implicit.

### 1.10 Reconciliation

There is no event indexer. `ENABLE_EVENT_LISTENER` is declared and validated
(`link-backend/src/config/env.ts:26`) but never read anywhere. Two cron jobs exist:

- `syncDropsJob` (every 5 min) verifies receipts **for `PENDING` drops that already carry a
  `creationTxHash`** (`link-backend/src/jobs/syncDropsJob.ts:16-27`, receipt check at `:43`) — a
  state `confirmDrop` never produces, because it sets `creationTxHash` and `ACTIVE` together.
  **Confirmed:** the one receipt-verifying path is bypassed by the normal API flow.
- `expireDropsJob` (hourly, database-only, §1.8).

Claims, revocations, and receiver updates are never reconciled against chain events. The database can
therefore drift from chain state with no mechanism to repair it. This contradicts D-004.

---

## 2. Known concerns re-confirmed

Each entry states the concern, the evidence, the confidence, and what would settle it.

### 2.1 Active escrow can be swept by the contract owner — **Confirmed**

`emergencyWithdrawUSDC()` transfers the contract's **entire** USDC balance, including fully funded,
unclaimed drops, to `owner()`, with no exclusion for active escrow and no pause or timelock
(`GiftLink.sol:410-413`). This contradicts D-006 directly.

- *Unresolved check:* whether the owner address is a single EOA or a multisig, and whether the
  function has ever been used. Both are `Unknown` from the repository.
- *Note:* `Ownable` also permits `updateBackendSigner` (`GiftLink.sol:346-351`) and
  `updateDefaultGasTank` (`GiftLink.sol:357-362`), so owner control extends to the authorization
  signer itself.

### 2.2 Recipient verification is not enforced on the live claim path — **Confirmed**

`relayClaim` (`dropService.ts:501-673`) checks one thing about identity: that the plaintext signature
was produced by the address being paid (`:549-556`). For `WALLET` drops it additionally compares the
claimer address to `drop.recipientIdentifier` (`:570-576`). For `EMAIL`, `DISCORD`, and `TWITTER` the
verification branch is an empty comment:

```ts
} else if (requiresAuthorization(recipientType)) {
  // Verify the claimer matches the recipient
  // The drop's recipientIdentifier should match the claimer's identifier
  // This is already validated by the signature verification above
}
```

(`dropService.ts:578-583`; the false claim is on line `:582`.) The plaintext signature proves control
of the *claimer* address, not that the claimer is the intended recipient. `requiresAuthorization`
returns true for everything except `PUBLIC` (`link-backend/src/utils/drop.ts:114-116`).

Compounding factors: the route has no `authenticate` middleware (`drops.ts:68-74`); the plaintext
challenge is not bound to the recipient, to the Drop's recipient commitment, or to any server-issued
nonce beyond `dropId` and a timestamp; and the `recipientCommit` stored on-chain is never consulted
at claim time (`GiftLink.sol:221-256`).

The consequence, as written: for any `EMAIL`/`DISCORD`/`TWITTER` drop, **any address can be paid** by
supplying its own signature over the documented message format for that `dropId`, within the
5-minute window. The drop link's UUID is the only secret in the way.

The correct check already exists — `issueClaimPermit` enforces a strict `recipientPrivyId` match
(`dropService.ts:370-395`) and recomputes the commitment (`:411-424`) — but that endpoint is not used
by the live claim flow.

- *Confidence:* **Confirmed** as a static code path. Not demonstrated end-to-end.
- *Unresolved check:* reproduce against a local chain with a funded `EMAIL` drop, claiming from an
  unrelated wallet.

### 2.3 Public drops can be claimed by any caller, to any address — **Confirmed**

`claimPublic(dropId, claimer)` requires no authorization of the caller and pays an **arbitrary
caller-supplied address** (`GiftLink.sol:262-286`). Any account can call it, not just the configured
relayer.

- First-claim-wins may be an acceptable product rule, but the contract does not constrain *who*
  receives the value, so the rule is not "the first eligible person claims" — it is "whoever calls
  first names the winner".

### 2.4 Revocation can be permanently blocked by a third party — **Confirmed**

`revokeDrop` requires `onlyActive` (`GiftLink.sol:290-295`). `markExpired` is permissionless and sets
the status to `EXPIRED` (`GiftLink.sol:332-338`), which is not `ACTIVE`. Any account can therefore
call `markExpired` on an expired drop and make the sender's refund permanently unreachable through
the normal path, leaving the only exit as the owner sweep of §2.1.

### 2.5 Recording trusts a client-supplied transaction hash — **Confirmed**

`recordDropClaim` checks that `request.txHash` has a successful receipt (`dropService.ts:697-703`)
but never decodes its logs, so any successful transaction hash on the same chain satisfies it. A
client can mark a drop `CLAIMED` without that drop being claimed, flipping `status`, `claimerAddress`,
`claimedAt`, and writing the `CLAIMED` event (`dropService.ts:675-735`).

The same pattern appears in `confirmDrop` (§1.3) and `recordDropRevocation`
(`dropService.ts:761-763`). D-004 requires the chain to be authoritative; today the database is the
authority and the chain is corroboration.

### 2.6 ABI drift — **Confirmed, with a precise scope**

The backend ABI is a different contract generation from the deployed one and says so itself:
`// This is a placeholder - replace with the actual contract ABI`
(`link-backend/src/config/abi.ts:2`).

| Member | Backend ABI (`config/abi.ts`) | Contract (`GiftLink.sol`) / frontend (`lib/abi.ts`) |
| --- | --- | --- |
| Constructor | `(address initialBackendSigner)` | `(address usdcAddress, address initialBackendSigner, uint128 initialGasTank)` |
| Create | `createDropETH(...) payable`, `createDropToken(address,...)` | `createDrop(uint128,uint128,bytes32,uint8,uint64)` |
| `claimPublic` | `(uint256 dropId)` | `(uint256 dropId, address claimer)` |
| `DropClaimed` | `(dropId, claimer, token, amount)` | `(dropId, claimer, relayer, amountToClaimer, amountToRelayer)` |
| `getDrop` | `(sender, token, amount, …)` | `(sender, amount, gasTankAmount, …)` |
| `DropRevoked` | `(dropId, sender)` | `(dropId, sender, totalRefunded)` |

Useful detail: `claimWithPermit` is the only member that matches both ABIs, so `relayClaim` works
today — which is also why the drift has gone unnoticed. The divergence is not limited to argument
order: the backend's `DropCreated` declares a third indexed `token` argument, so its event signature
and therefore its topic hash differ from the contract's. `contract.queryFilter(contract.filters.DropCreated(), …)`
in `syncDropsJob` (`link-backend/src/jobs/syncDropsJob.ts:51-55`) can match no real log at all, on top
of the unreachable-query problem in §1.10. The frontend ABI
(`link-gift-send/src/lib/abi.ts`) matches the Solidity source.

### 2.7 Expiry and refund behaviour is incomplete and split across layers — **Confirmed**

Summarised from §1.8 and §1.9: the database expires drops hourly; the chain never learns; nothing
calls `markExpired`; there is no on-chain expired transition, no automatic refund, and no "reclaim"
concept at all. Reclaim today is "the sender may revoke any active drop at any time", which is a
different product rule from the expiry-bound recovery in `docs/PRODUCT.md`.

### 2.8 Receiver edits change database state only — **Confirmed**

`updateDropReceiver` writes `recipientIdentifier`, `recipientType`, `recipientPrivyId`, and
`recipientCommit` to the database and appends a `RECEIVER_UPDATED` event
(`dropService.ts:785-846`). It never calls the contract's `updateReceiver`
(`GiftLink.sol:313-325`), and the frontend never calls it either. The on-chain commitment is
therefore permanently stale after any edit, and `issueClaimPermit`'s commitment comparison
(`dropService.ts:411-424`) uses the database value — so the chain holds a commitment that no longer
matches the system's own authorization inputs.

### 2.9 Identity normalization is inconsistent across flows — **Confirmed**

- `normalizeIdentifier` lower-cases **every** identifier type with no per-type rules
  (`link-backend/src/utils/drop.ts:26-41`).
- `extractIdentities` stores `discordId`/`twitterId` **without** lower-casing, taking
  `account.userId ?? account.username` (`authService.ts:110-135`).
- `getClaimableDrops` compares the lower-cased `recipientIdentifier` against those stored values
  (`dropService.ts:917-955`), and `lookupUserPrivyId` queries the same columns with a lower-cased
  identifier (`dropService.ts:111-152`).

A mixed-case social handle therefore fails to match itself, so the recipient can neither discover the
drop in their inbox nor be recognised as its recipient. Email has a second gap: a case-folded
`@gmail.com` address is not canonicalised against dots or aliases.

### 2.10 Unsafe and incoherent network defaults — **Confirmed**

| Surface | Value | Evidence |
| --- | --- | --- |
| Backend `RPC_URL` example | `https://mainnet.infura.io/v3/your_key` | `link-backend/.env.example:3` |
| Backend `CHAIN_ID` example | `1` (Ethereum mainnet) | `link-backend/.env.example:4` |
| Backend `FRONTEND_URL` example | `https://giftlink.app` | `link-backend/.env.example:14` |
| Frontend chain-id fallback | `1243` | `main.tsx:19`, `lib/chainUtils.ts:9`, `pages/Create.tsx:44` |
| Frontend RPC fallback | `https://rpc.testnet.arc.network` | `main.tsx:29,47`; `lib/chainUtils.ts:23,122` |
| Frontend `VITE_ARC_RPC_URL` example | `https://rpc.arc.network` | `link-gift-send/.env.example` |
| Frontend USDC fallback | zero address, and elsewhere `"0x"` | `hooks/useAggregateBalance.ts:12`, `hooks/useWalletBalances.ts:12`, `pages/Settings.tsx:38`; `"0x"` at `pages/Create.tsx:205,316` |
| Frontend contract-address fallback | `"0x"` (and no fallback at all in `useCreateDrop.ts:44`) | `hooks/useArcClient.ts:22` |
| Frontend API fallback | `https://api.giftlink.arc` | `services/api.ts:19` |
| Privy app id fallback | `""` | `main.tsx:15` |

Three distinct problems: the examples describe an unrelated chain; the frontend's own example and
code fallback disagree about mainnet versus testnet; and missing configuration degrades to a zero
address or an empty string instead of failing loudly. `https://giftlink.app` compounds this: it is the
example value used to build share links (`dropService.ts:1060-1061`), and nothing in this repository
establishes that the project controls that domain. Treat it as unverified and replace it with a
project-controlled origin.

The CORS origin also reads `process.env.FRONTEND_URL` directly, bypassing the validated `env`, and
falls back to `"*"` alongside `credentials: true` (`link-backend/src/index.ts:16-21`, origin at `:18`).

**Also confirmed:** the local (gitignored) frontend environment configures a chain id that differs
from the in-code fallback, so the repository alone does not determine which chain is in use. The value
is not reproduced here because it exists only in an untracked file.

### 2.11 Identity-token and private-data logging — **Confirmed**

This is the finding the issue asked to inspect specifically.

- **Identity token logged in the authentication middleware:**
  `console.log(idToken, "idToken");` — `link-backend/src/middleware/auth.ts:30`. This writes the full
  bearer identity token to stdout on **every authenticated request**. The token is a live credential
  for the session, and the request continues normally, so production request volume determines how
  many credentials reach the log sink.
- The same token is logged in the browser: `console.log(identityToken, "identityToken");` —
  `link-gift-send/src/services/api.ts:69`.
- Also logged: the EIP-712 permit signature (`dropService.ts:605`), the relayer's native balance
  (`:609`), the transaction object (`:634`), the private identity linkage
  `logger.info(recipientPrivyId, authenticatedUserPrivyId, "recipientPrivyId")`
  (`dropService.ts:331`), and the whole user record via `logger.info(user, "Authenticated user")`
  (`authService.ts:20`).

D-008 constrains raw identifiers from reaching *public* logs and *on-chain* state. These are
application logs, but they carry the same data class, and the identity token is a credential rather
than an identifier. The non-development logger emits raw JSON (`link-backend/src/config/logger.ts`),
so redaction must be explicit rather than assumed.

- *Unresolved check:* the log retention policy and sink, and whether any of these lines have run in a
  deployed environment. `Unknown` from the repository.

**Where the open checks are.** Concerns §2.3–§2.10 are settled by static reading alone and carry no
runtime check; each is fully determined by the source cited. The findings that still need runtime or
deployment evidence are §2.1 (owner key custody), §2.2 (end-to-end reproduction), §2.11 (log sink and
retention), and the six deployment-state unknowns in §3.

### 2.12 Additional findings not in the build brief

| Finding | Evidence | Confidence |
| --- | --- | --- |
| Amounts are computed with floating-point arithmetic: `BigInt(Number(data.amount) * 1e6)` can throw or silently mis-scale | `dropService.ts:210` | **Confirmed** |
| `getStatsOverview` wraps `BigInt(amount)` in `try/catch` and skips failures, so total volume silently under-reports for any decimal amount | `dropService.ts:957-1008` | **Confirmed** |
| Drop ids are `uint32(block.timestamp ^ _nonce)`, truncated to 32 bits and predictable; a collision reverts creation | `GiftLink.sol:184-189` | **Confirmed** |
| Gas-tank estimation divides native wei by `1e12` to reach 6-decimal USDC, i.e. it assumes native gas is USDC at 1:1 | `dropService.ts:51-109` | **Assumption** — plausible on Arc, unverified here |
| A gas-estimation failure silently falls back to a fixed 5 USDC charge | `dropService.ts:97-105` | **Confirmed** |
| `Drop.recipientIdentifier` and `SocialIdentity.identifierRaw` store raw emails/handles in plaintext | `prisma/schema.prisma:39,74` | **Confirmed** |
| Four frontend client methods call endpoints that do not exist: `POST /api/users/logout`, `POST /api/drops`, `GET /api/drops/:id/permit`, `POST /api/drops/:id/claim` | `services/api.ts` (`logoutUser`, `createDrop`, `getClaimPermit`, `claimDrop`) | **Confirmed** |
| The on-chain `recipientCommit` is never validated at claim time, so it is documentation rather than enforcement | `GiftLink.sol:221-256` | **Confirmed** |
| `GET /api/users/:address/drops` authenticates and then ignores `:address`, always using the caller's `privyId` | `routes/users.ts:30-36`; `dropController.ts:206-235` | **Confirmed** |
| No test files, no contract build or deploy tooling, and no deployment artefacts exist anywhere in the repository | repository-wide file search | **Confirmed** |

---

## 3. Retain / repair / replace map

"Retain" means keep the shape and fix details. "Repair" means the component is the right one but its
guarantees are not yet trustworthy. "Replace" means it cannot satisfy the required guarantees and
should not hold campaign custody or authorization.

| Component | Decision | Rationale | Evidence |
| --- | --- | --- | --- |
| Privy identity + session; server-derived wallet binding | **Retain** | Correct shape: the server derives identity from `linkedAccounts` and never trusts a client-asserted address. Reusable for Resolver-backed eligibility. | `authService.ts:28-60,83-146`; `dto/user.dto.ts` |
| Express structure, Zod validation, Helmet, rate limiting | **Retain** | Conventional and adequate. Add route-level auth defaults and stop reading `process.env` beside the validated `env`. | `index.ts:10-33`; `middleware/validator.ts:5-45`; `middleware/rateLimiter.ts` |
| Prisma `User` model | **Retain** | `privyId` as the stable internal key is the right anchor for entitlement uniqueness. | `prisma/schema.prisma:13-30` |
| `SocialIdentity` table | **Repair** | Useful, but written only on the unused permit path and stores raw identifiers. Needed properly for single-use entitlements. | `dropService.ts:428-452`; `schema.prisma:71-85` |
| EIP-712 permit model (domain + single-use transition) | **Repair** | Domain separation and the status-before-transfer pattern are sound and reusable. Needs campaign and nullifier binding, and must become the enforced path. | `utils/eip712.ts:3-20`; `GiftLink.sol:221-256` |
| Relayer / gas sponsorship | **Repair** | Working, correctly scoped to claims, and the claimant never handles gas. Must not remain the only thing standing between an attacker and payout. | `dropService.ts:586-660` |
| `GiftLink.sol` | **Replace** | Owner can sweep active escrow; recipient verification is not enforced on-chain; reclaim is impossible after a permissionless `markExpired`; expiry never reaches the chain; no campaign, cap, or per-identity entitlement. | `GiftLink.sol:221-256,262-286,290-305,332-338,410-413` |
| `relayClaim` | **Replace** | The live claim path: unauthenticated route, empty recipient verification, plaintext challenge. The correct logic already exists in the unused `issueClaimPermit`. | `drops.ts:68-74`; `dropService.ts:501-583` |
| Backend `config/abi.ts` | **Replace** | A different contract generation; only `claimWithPermit` coincidentally matches. | `config/abi.ts:2`; §2.6 |
| Database-as-authority recording (`confirmDrop`, `recordDropClaim`, `recordDropRevocation`, `updateDropReceiver`) | **Replace** | Trusts client-supplied hashes and identifiers; makes the database authoritative over the chain, against D-004. | `dropService.ts:261-306,675-735,737-783,785-846` |
| Cron jobs (`syncDropsJob`, `expireDropsJob`) | **Repair** | Reconciliation is the right need and cron is a reasonable mechanism, but neither job reconciles claims, revocations, or expiry against chain events, and the sync job's query is unreachable in practice. | `jobs/syncDropsJob.ts:16-27`; `jobs/expireDropsJob.ts:6-52` |
| `GET /api/drops/:id` as a link-addressed read | **Repair** | A UUID-addressed read is a reasonable public surface, but today it is also the only thing protecting a targeted drop (§2.2). | `dropController.ts:53-58` |
| Frontend routing, auth gate, wallet integration | **Retain** | `/`, `/app`, `/dashboard`, `/create`, `/claim/:id`, `/activity`, `/settings` work and were preserved unchanged by the landing-page change. | `link-gift-send/src/App.tsx:20-28` |
| Frontend design tokens and shell | **Retain** | Now mapped to the approved Nomine tokens (`link-gift-send/src/index.css`); reusable for Studio and Inbox. | `brand/approved/tokens.css` |
| Frontend `services/api.ts` | **Repair** | Reasonable single client, but remove the token log, drop the dead endpoints, and stop defaulting to a third-party domain. | `services/api.ts:19,69` |
| Optimistic claim UI | **Repair** | Acceptable as feedback, but must not be the definition of "Completed". "Completed" requires confirmed settlement. | `Claim.tsx:82-89`; `docs/PRODUCT.md` |
| Locally computed `expiry` and client-asserted `senderAddress` | **Repair** | The server must own availability windows and derive the payer from the chain. | `Create.tsx:227-240`; `dropService.ts:155-257` |
| Existing gift records, claim links, and custody | **Keep in place, do not migrate** | D-018 and the issue's non-goals: legacy gifts stay on the legacy contract; migration needs an explicit plan. | `docs/DECISIONS.md` D-018 |

### Deployment-state unknowns

None of the following can be settled from the repository, and all of them gate any completion claim:

1. Whether `GiftLink.sol` is deployed, at which address, on which chain, and whether the deployed
   bytecode matches this source. **Unknown.**
2. Whether `backendSigner` on the deployed contract matches the local configuration. **Unknown.**
3. Whether the owner address is an EOA or a multisig. **Unknown.**
4. Whether the relayer holds funds, and whether gas sponsorship has ever settled a claim. **Unknown.**
5. Whether the database and chain currently agree for any existing drop. **Unknown.**
6. Whether log retention has already captured identity tokens from live traffic. **Unknown.**

Settling 1–5 requires deployment records and read access to the chain; settling 6 requires the log
sink. Neither was available for this audit.
