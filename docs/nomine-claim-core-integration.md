# Claim Core integration contract

Canonical integration facts shared by `link-backend` and `link-gift-send` when they talk to the
deployed Nomine Claim Core. Both projects must match this document exactly; the contract is the source
of truth and neither client may invent a field, a type, or a fallback.

Decisions: `docs/DECISIONS.md` D-006, D-007, D-008, D-010, D-018, D-019. Contract: `link-contracts/contracts/NomineClaimCore.sol`.

## 1. Deployment

| Fact | Value |
| --- | --- |
| Contract | `NomineClaimCore` |
| Chain ID | `5042002` (Arc testnet) |
| Address | `0x9D390dCa06118302C8194CC214Ed9BC7f5969810` |
| USDC (ERC-20 interface) | `0x3600000000000000000000000000000000000000` (6 decimals) |
| ABI | `link-contracts/abi/NomineClaimCore.json` |
| EIP-712 domain | name `NomineClaimCore`, version `1`, chainId + verifyingContract |
| Explorer | `https://explorer.testnet.arc.io` |

Deployment evidence: `link-contracts/deployments/arc-testnet.json`, `arc-testnet-runtime.md`.

Configuration is **explicit and fails closed**: if the configured chain ID or contract address does not
match the RPC it is talking to, the client must refuse to send a transaction rather than fall back to a
legacy contract or another chain. `VITE_CLAIM_CORE_ADDRESS` / `CLAIM_CORE_CONTRACT_ADDRESS` have no
default that silently points somewhere else.

## 2. On-chain types (field order is significant)

```
CampaignConfig { address issuerApprover; address resolver; uint128 allocation; uint64 openingTime; uint64 expiryTime; bytes32[] entitlementIds; }
ClaimRequest   { uint256 campaignId; bytes32 entitlementId; address wallet; uint256 amount; uint64 deadline; }
Approval       { uint256 campaignId; bytes32 entitlementId; address wallet; uint256 amount; uint64 deadline; bytes32 consentDigest; }
```

EIP-712 type strings (must match on-chain typehashes byte for byte):

```
ClaimRequest(uint256 campaignId,bytes32 entitlementId,address wallet,uint256 amount,uint64 deadline)
Approval(uint256 campaignId,bytes32 entitlementId,address wallet,uint256 amount,uint64 deadline,bytes32 consentDigest)
```

Functions: `createCampaign(CampaignConfig)`, `settle(ClaimRequest,bytes claimantSignature,Approval,bytes issuerApprovalSignature,bytes resolverApprovalSignature,bytes32[] entitlementProof)`, `reclaim(uint256)`, plus views `campaignCount()`, `getCampaign(uint256)`, `isEntitlementConsumed(uint256,bytes32)`, `budgetOf`, `settledAmountOf`, `remainingUnsettledOf`, `reclaimableOf`, `USDC()`.

Events (the only canonical evidence): `CampaignFunded(campaignId indexed, issuer indexed, issuerApprover indexed, resolver, allocation, entitlementCount, fundedAmount, openingTime, expiryTime, entitlementRoot)`, `Settlement(campaignId indexed, entitlementId indexed, wallet indexed, amount, submitter)`, `CampaignReclaimed(campaignId indexed, issuer indexed, amount)`. There is deliberately no expiry event — time passing creates no on-chain transition.

## 3. Two payloads

**Claimant consent.** The claimant signs the `ClaimRequest` with their selected payout wallet. This is the
only signature that chooses the destination. `deadline` is an absolute unix seconds value.

**Authority attestation.** Both the issuer approver and the Resolver sign the same `Approval`, whose
`consentDigest` is the claimant's EIP-712 digest. The approval is therefore bound to the exact signed
request by content; there is no ordering claim. The contract recomputes both the request digest and the
approval digest, so a mismatched `consentDigest` is rejected as `ApprovalMismatch`.

Deriving the consent digest off-chain:

```
digest = _hashTypedDataV4(hashStruct(ClaimRequest))   // ethers: TypedDataEncoder.hash(domain, types, request)
```

## 4. Entitlement identifiers and the membership commitment

- One **high-entropy, campaign-specific** identifier per listed recipient. Generate it randomly
  (32 random bytes) at assignment time and persist it. **Never** derive it from an email, and never use a
  public hash of an email.
- The exact set is supplied to `createCampaign` in **strictly ascending** byte order; that single
  constraint makes the set non-empty, non-zero and unique, and fixes the funded count.
- The commitment is a Merkle root over `leaf(id) = keccak256(id)`, with order-independent pair hashing
  `keccak256(sorted(a,b))` and the last node of an odd level promoted unchanged. Settlement proves the
  **leaf**, so the root and internal nodes are not valid identifiers.
- Off-chain accounting must reconstruct the same leaf/pair rules; a divergence shows up immediately as
  `EntitlementNotListed`.

## 5. Verified-email eligibility

- The verified email comes **server-side from the identity provider** (Privy `email` linked account).
  Caller-supplied email, query parameters and UI flags are never proof.
- Normalization is conservative and provider-compatible: trim, Unicode NFC, lowercase the whole address.
  **Do not** invent Gmail-style dot or plus-alias merging.
- Store `emailHash = HMAC-SHA256(SERVER_PEPPER, normalizedEmail)`. Raw emails stay out of logs, events,
  URLs, analytics, error responses and chain data (D-008).
- A verified matching identity maps to the original campaign entitlement regardless of signup time, login
  retry or later linked-wallet changes. Re-login must not create a second entitlement or a second claim.

## 6. Data model (Prisma)

- `Campaign` — chainId, contractAddress, `onchainId?`, issuer privyId + address, issuerApproverAddress,
  resolverAddress, allocation (base units, string), entitlementCount, `fundingTxHash?`, paramsHash,
  openingTime, expiryTime, status (`DRAFT | FUNDED | RECLAIMED`), `reclaimedTxHash?`.
- `Entitlement` — campaignId, `entitlementId` (hex), `emailHash`, `consumedAt?`, `settlementTxHash?`,
  `claimantAddress?`. Unique on `(campaignId, entitlementId)` and `(campaignId, emailHash)`.
- `ClaimRequest` — campaignId, entitlementId, walletAddress, amount, deadline, status
  (`CONSENTED | ISSUER_APPROVED | SUBMITTED | SETTLED | FAILED | EXPIRED`), `consentSignature?`,
  `consentDigest?`, `issuerApprovalSignature?`, `resolverSignature?`, `submitTxHash?`, `settlementTxHash?`,
  `failureReason?`. One live request per entitlement.
- `ClaimEvent` — canonical indexed chain events, unique on `(txHash, logIndex)`; the dedup ledger.
- `ChainCheckpoint` — one row per (chainId, contractAddress) with the last scanned block.

Migrations are not committed in this repository (`prisma/migrations/` is gitignored); the pilot applies
schema changes with `prisma db push`. Changing that convention is out of scope.

## 7. Status model and UI mapping

On-chain lifecycle is authoritative and has exactly three claimant-facing groups: **Available**,
**Completed**, **Expired**. Everything else is a workflow status inside Available.

| Off-chain state | Meaning | UI |
| --- | --- | --- |
| funded, before `openingTime` | funded, not yet claimable | **Available** + `Opens <date/time>` (timezone shown), claiming disabled |
| `CONSENTED` | claimant signed, issuer has not | **Awaiting issuer confirmation** |
| `ISSUER_APPROVED` | issuer signed, Resolver/submission outstanding | **Awaiting Resolver attestation / submission** |
| `SUBMITTED` | relay broadcast, unconfirmed | pending submission, never `Completed` |
| `SETTLED` + canonical `Settlement` event to the exact wallet/amount | consumed | **Completed** |
| unconsumed at/after `expiryTime` | not settled | **Expired** |

Rules: only a verified `Settlement` event consumes the entitlement and marks it Completed — a signed
request or a transaction hash is not settlement. `Completed` survives campaign expiry. There is no
oversubscription and no fabricated Expired state: an eligible unconsumed entitlement with no backing is a
reconciliation error, not normal behaviour.

## 8. API contract

All routes are under `/api`. Authenticated routes verify the Privy bearer token. Ownership is enforced on
every route: an issuer sees only their own campaign roster; a claimant sees only their own entitlements.

Issuer (Studio):

- `POST /campaigns/prepare` — body `{ allocation, emails[], openingTime, expiryTime, issuerApproverAddress }`.
  Normalizes/dedups emails, assigns identifiers, persists `DRAFT`, returns the exact `CampaignConfig`
  payload the funding wallet must submit plus count, budget and root.
- `POST /campaigns/:id/confirm` — body `{ txHash }`. Verifies the canonical `CampaignFunded` event matches
  the stored config exactly (count, allocation, root, approver, resolver, times), sets `FUNDED`. Idempotent.
- `GET /campaigns` — the authenticated issuer's campaigns with chain totals.
- `GET /campaigns/:id` — issuer-only detail incl. private roster summary and accounting.
- `GET /campaigns/:id/requests` — issuer-only approval requests (consent + wallet + amount + deadline).
- `POST /campaigns/:id/requests/:requestId/issuer-approval` — body `{ signature }`. Verifies the signature
  recovers to the campaign's configured `issuerApprover`, stores it, advances to `ISSUER_APPROVED`.
- `POST /campaigns/:id/recover/confirm` — body `{ txHash }`. Verifies `CampaignReclaimed` and marks
  `RECLAIMED`. Recovery needs no approver.

Claimant (Inbox):

- `GET /campaigns/:id/public` — public link view (no roster): issuer, allocation, count, funding status,
  opening/expiry, both authorities, USDC, fixed recovery rule.
- `GET /inbox` — the authenticated claimant's own funded entitlements, with campaign public info and status.
- `POST /campaigns/:id/consent` — body `{ entitlementId, walletAddress, amount, deadline, signature }`.
  Server-side verified-email eligibility + signature check, then stores a `CONSENTED` request.
- `GET /campaigns/:id/requests/:requestId` — owner or issuer; status + receipt.
- `POST /campaigns/:id/requests/:requestId/settle` — sponsored relay. Requires consent + issuer approval,
  attaches the Resolver attestation, broadcasts from the relayer wallet, verifies the `Settlement` event to
  the exact wallet and amount, persists the receipt. Idempotent and safe to retry.

Sponsorship is scoped to the Claim Core `settle` call after authorization and simulation, with bounded
rate limits. Relay/RPC failure must never consume an entitlement or masquerade as completed settlement.
Sponsor gas is tracked separately and never counted as campaign funding.

## 9. Privacy and honesty

- No raw emails, tokens, private records, signing keys or live authorization dumps in logs, browser logs,
  URLs, analytics or error responses.
- No endpoint may enumerate another user's eligibility or a campaign roster.
- Manual issuer confirmation is a real human action through a known channel. The software shows it; it does
  not prove it. Automated simulated signers must never be presented as proof of the external approval
  process.
- Wallet consent proves control of a wallet, not ownership of an identity. Collusion between both Gate
  authorities remains the D-006 risk and must be stated, not hidden.
- The contract has **no revocation**. Changing wallet, re-signing, disconnecting or deleting a pending
  request does not invalidate an already-signed live authorization. The interface must present this
  honestly and prevent accidental conflicting active requests.

## 10. Environment configuration

Public (safe to expose, prefixed `VITE_` on the frontend): API base URL, chain ID, RPC URL, USDC address,
Claim Core address, Privy app ID.

Private (backend only, never exposed or committed): `RPC_URL` with credentials, `DEPLOYER_PRIVATE_KEY`,
`RELAYER_PRIVATE_KEY`, `BACKEND_SIGNER_PRIVATE_KEY` (Resolver attestation key), `SERVER_PEPPER`,
`PRIVY_APP_SECRET`, `DATABASE_URL`.

Secrets live in the environment, never in the repository. The Resolver key is held by Nomine; the issuer
approval key is the issuer's and is never requested, uploaded, stored or available to Nomine.
