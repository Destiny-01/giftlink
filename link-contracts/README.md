# Nomine Claim Core (`link-contracts`)

Immutable, fully funded, fixed-allocation USDC campaigns with dual EIP-712
attestation. A listed entitlement settles exactly once, only to the wallet the
claimant signed for, and only with **both** an independent issuer attestation and a
Nomine Resolver attestation over that same signed request.

This package is the on-chain half of the V1 Claim Core. It deliberately contains
**no owner, no upgrade path, no authority replacement and no sweep function** — the
absence of those entry points is the guarantee, not a policy.

## Layout

| Path | Purpose |
| --- | --- |
| `contracts/NomineClaimCore.sol` | The Claim Core contract. |
| `contracts/test/MockUSDC.sol` | 6-decimal USDC stand-in for the in-process network only. |
| `test/claim-core.test.ts` | Contract, adversarial, timing, accounting and event-replay tests. |
| `lib/merkle.ts`, `lib/eip712.ts` | Tree builder and EIP-712 helpers shared by tests and the example. |
| `scripts/deploy.ts` | Fail-closed Arc deployment with a preflight. |
| `scripts/claim-lifecycle-example.ts` | Reproducible end-to-end coordination example. |
| `scripts/export-abi.ts` | Regenerates `abi/NomineClaimCore.json` from the compiled artefact. |
| `config/arc.ts` | Explicit Arc network parameters. Nothing here is defaulted. |

## Lifecycle

`createCampaign` fixes **issuer**, **issuer approver**, **resolver**, **recovery
destination**, **allocation**, **entitlement count**, **opening time**, **expiry
time** and a **membership commitment** (a Merkle root over the actual entitlement
identifiers). The full budget — `allocation × entitlementCount` — is transferred in
the same call, so an unfunded campaign never exists and the stored `entitlementCount`
is always fully backed. There is no separate cap the eligible list may exceed, and no
oversubscription.

Settlement is permitted only when all of these hold. The campaign, entitlement, wallet, amount, chain,
contract and deadline are bound into the claimant's signature and both attestations; the time window,
capacity and consumption state are enforced from campaign state and cannot be signature-bound:

- now is within `[openingTime, expiryTime)`;
- the entitlement identifier is a leaf of the committed tree;
- the identifier is unconsumed;
- the requested amount equals the campaign's fixed `allocation`;
- the approval deadline has not passed;
- the claimant's consent recovers to the signed payout wallet;
- both approving-authority signatures recover to the campaign's distinct issuer
  approver and Resolver.

Reclaim is issuer-only, expiry-only, and independent of both Gate attestations and
claimant consent. It returns exactly the unsettled balance to the recovery
destination fixed at funding.

Derived, so no stored value can disagree with the chain:

```
budget        = allocation × entitlementCount
settled       = settlementCount × allocation
remaining     = (entitlementCount − settlementCount) × allocation
reclaimable   = budget − settled
```

Membership is a Merkle proof against the committed root. The contract sees only the root, so it cannot
check that the committed leaf count equals `entitlementCount` or that the leaves are distinct. The
commitment must therefore list exactly one identifier per funded entitlement. A commitment listing fewer
distinct identifiers than the funded count cannot over-pay — each identifier settles once — but the
surplus stays in escrow until expiry recovery.

## How the approvals are tied to the signed request

The claimant signs `ClaimRequest(campaignId, entitlementId, wallet, amount, deadline)`
under the EIP-712 domain `(NomineClaimCore, 1, chainId, verifyingContract)`. Each
approving authority signs an `Approval` carrying the same five fields **plus
`consentDigest`** — the claimant's own EIP-712 digest. The contract recomputes that
digest and requires it to match, so an approval is cryptographically bound to the
exact request the claimant signed.

This is deliberately *not* a claim about ordering in time. Two signatures cannot
prove who acted first, so the design does not rely on it: the binding is by content
(the digest), and the contract refuses any approval whose content does not match the
request. See `test/claim-core.test.ts` ("binds both attestations to the claimant's
signed request digest").

## Trust boundary (D-006 / D-019)

What the contract enforces:

- custody: no role can move escrow before expiry, and reclaim moves only the
  unsettled balance to the fixed destination;
- single use: each entitlement identifier settles at most once;
- payout integrity: the amount is fixed and the destination wallet is the one the
  claimant signed for, so no relayer or submitter can redirect it;
- distinct authorities: a configuration naming the same address for both approving
  authorities is refused at funding.

What the contract **cannot** do, and must never be described as doing:

- **Prove identity ownership.** It sees only an opaque, high-entropy, campaign-specific
  entitlement identifier. Wallet consent proves control of the wallet, not ownership
  of the off-chain identity behind the entitlement. Membership in a fixed commitment
  does not eliminate this.
- **Prove who controls the two authority keys.** It can only refuse the same address
  for both. Nothing on-chain establishes that the issuer approver key is held outside
  Nomine; that is an operational property.
- **Prevent collusion between both Gate authorities.** If both authorities collude
  they can assign an unused entitlement to a wallet they control and sign as that
  wallet. This remains an explicit Gate-trust risk, not a bug that tests can establish
  away.

### Issuer-independent verification procedure (pilot)

Manual confirmation is limited to the first controlled pilot and is **not** the
intended long-term claimant experience. The procedure the pilot must follow:

1. The issuer lists the entitlements and computes the membership commitment **outside
   Nomine**; Nomine never supplies the identity-to-entitlement mapping as the sole
   source of truth.
2. When a claimant selects a wallet, the claimant signs the `ClaimRequest` in their
   own wallet. Nomine displays the pending state and submits nothing yet.
3. The issuer approver independently verifies the identity-to-wallet assignment
   **through a known channel** (not by trusting a value Nomine displayed) and only
   then signs the `Approval`. The issuer approver key never enters Nomine's
   infrastructure, configuration, or logs.
4. The Resolver verifies membership and signs the same `Approval`.
5. Only then is the sponsored settlement submitted.

A later replacement of manual confirmation requires an explicit design decision that
preserves this trust boundary.

### Key-loss behaviour

Losing either approving key stops settlement until expiry — it cannot be replaced,
because funded campaigns are immutable. It does **not** strand funds: `reclaim`
depends on neither Gate signer nor claimant consent, so the issuer can always recover
the unused balance to the fixed destination after expiry. This is asserted by the
"works without either approving authority participating" test.

### Remaining collusion risk

Collusion between the issuer approver and the Resolver (or compromise of both) is
bounded by remaining campaign capacity, which in this model equals the fully funded
entitlement count — every listed entitlement is backed by its own allocation, so the
exposure is exactly the value the campaign still holds. Per-entitlement single use
survives collusion; per-identity uniqueness does not.

## Arc configuration and deployment

`config/arc.ts` holds the only accepted chain parameters. The RPC URL is never
defaulted — an operator supplies it through `ARC_TESTNET_RPC_URL` /
`ARC_MAINNET_RPC_URL`. Deployment runs a preflight that refuses to continue unless
the live chain ID matches the configured chain ID and the configured USDC address has
code and reports the expected decimals.

```bash
npm install
npm run compile
npm test            # 37 tests
npm run typecheck
npm run export-abi  # regenerates abi/NomineClaimCore.json

# Preflight only (no broadcast):
ARC_NETWORK=testnet ARC_TESTNET_RPC_URL=... npm run preflight:testnet

# Broadcast requires an explicit gate:
ARC_NETWORK=testnet ARC_TESTNET_RPC_URL=... DEPLOYER_PRIVATE_KEY=... \
  ARC_DEPLOY_CONFIRM=1 npm run deploy:testnet
```

A mainnet broadcast additionally requires `ARC_MAINNET_APPROVED=yes`; that is the
explicit approval gate, not an incidental default.

### Testnet deployment status — blocked

No contract has been deployed to Arc testnet from this branch. The preflight stops
for a concrete reason: this environment has no `ARC_TESTNET_RPC_URL` and no funded
`DEPLOYER_PRIVATE_KEY`, and the acceptance criteria forbid inventing either. The
deployment path, preflight, and record format are complete and reproducible; running
the commands above with real testnet credentials produces
`deployments/arc-testnet.json` and the explorer links. Until then no address,
transaction hash, or verified contract is claimed.

## Out of scope

No legacy GiftLink custody migration or `GiftLink.sol` patch, no Inbox/Studio UI, no
automated long-term issuer verification, no production or mainnet rollout, no swaps,
adapters, callbacks, cross-chain settlement, protocol token, open Resolver market, or
upgradeable custody. Existing GiftLink gifts remain accessible on the legacy contract.
Meaningful-value custody still requires independent review.
