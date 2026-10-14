# Arc testnet pilot walkthrough — two recipients

Completed **2026-09-26T15:35:09Z** against the deployed Nomine Claim Core. Machine-readable evidence:
[`pilot-walkthrough-arc-testnet.json`](./pilot-walkthrough-arc-testnet.json).

| Fact | Value |
| --- | --- |
| Chain ID | `5042002` (Arc testnet) |
| Contract | [`0x9D390dCa06118302C8194CC214Ed9BC7f5969810`](https://explorer.testnet.arc.io/address/0x9D390dCa06118302C8194CC214Ed9BC7f5969810) |
| USDC | `0x3600000000000000000000000000000000000000` (6 decimals) |
| Campaign | `4` |
| Allocation | `0.10` USDC per entitlement |
| Listed entitlements | `3` (all fully funded, budget `0.30` USDC) |
| Opening / expiry | `1790436769` / `1790436889` (a real ~120 s window) |

## What the walkthrough exercised

1. **Funding.** The issuer approved USDC and called `createCampaign` with three strictly ascending
   identifiers. The canonical `CampaignFunded` event reports `entitlementCount = 3` and
   `fundedAmount = 0.30`, and the derived commitment matched the off-chain tree.
2. **Two sponsored settlements.** Each recipient signed only the EIP-712 `ClaimRequest` choosing their own
   wallet; the issuer approver and the Resolver signed the same `Approval` (carrying the claimant's consent
   digest); the sponsor submitted `settle`. Both recipients received **exactly `0.10` USDC** and consumed
   their entitlement. Neither recipient sent a transaction, so neither paid gas — sponsorship is outside
   escrow and did not reduce the payout.
3. **Refusals** (static calls against live state — no failed transaction was broadcast):
   - replay of a settled entitlement → `EntitlementAlreadyConsumed`
   - issuer approval reused as the Resolver attestation → `InvalidResolverApproval`
   - settlement after expiry → `CampaignExpired`
4. **Expiry recovery.** After the real expiry, the issuer reclaimed the one unused allocation. The unused
   balance returned even though **neither approving authority participated**.
5. **Canonical event replay.** Reconstructing from `CampaignFunded` / `Settlement` / `CampaignReclaimed`
   only: `funded 300000 = settled 200000 + reclaimed 100000` (base units), campaign escrow `0`.

## Transactions

| Step | Transaction |
| --- | --- |
| Fund campaign (`0.30` USDC, 3 entitlements) | [`0xd494af87…4564b`](https://explorer.testnet.arc.io/tx/0xd494af87b97d9c969cfddc6ace1c8557433cf0c565e2684c83c1050a38e4564b) |
| Sponsored settlement — recipient 1 | [`0x526506cb…d0c58`](https://explorer.testnet.arc.io/tx/0x526506cb811510de0ef7e89b1739ce0985f0822a5029568a821999ebbeed0c58) |
| Sponsored settlement — recipient 2 | [`0x14b6583f…a2ef4`](https://explorer.testnet.arc.io/tx/0x14b6583fe74eba5b7f22ed47d2c90c93573722343a750f6d68983f26737a2ef4) |
| Expiry recovery (`0.10` USDC to the issuer) | [`0x7875c71f…234c1`](https://explorer.testnet.arc.io/tx/0x7875c71f14c42db281c1fe766aa14330a58eb5cb7903fa4edbe7c333e77234c1) |
| Cleanup: reclaimed the earlier run's stranded campaign `2` | [`0x5b89874c…8a30d`](https://explorer.testnet.arc.io/tx/0x5b89874cb8aa4470679b0515201eb6d166f57d17f4b32d9e1912de9f9c78a30d) |

## Actors and limits

- issuer (funder and recovery): `0xe3C71da511A74b18ac41d4E19308aeEE980b98E1`
- sponsor (relay): `0x7B1fE526f09FE1aD9FD0C228AA9FEDd271e2c201`
- issuer approver, resolver and both claimants were **ephemeral in-memory keys** generated for this run and
  discarded; only the addresses above are recorded.

**This is automated contract-and-signature evidence, not proof of the pilot's approval process.** The
issuer-approval signature here came from a generated key, so it demonstrates signature separation and the
contract's checks — it does **not** demonstrate the operational requirement that a real issuer independently
verifies the recipient-to-wallet assignment through a known channel and signs with an externally held wallet.
That is the human step Nomine Studio is built to perform, and it remains to be exercised end to end with the
actual issuer.

No mainnet transaction was made, no real funds were moved, and no custody audit is claimed. Arc produced
blocks on demand during the run, so the chain head's timestamp could lag wall clock; recovery used an
explicit gas limit to force a post-expiry block instead of estimating against a stale pre-expiry head.
