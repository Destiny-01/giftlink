# Arc testnet runtime proof

Completed 2026-09-26T13:59:22.507Z using approved source commit `fcfd71c3946d00f7a4a798def4d03a8eefff248a`.

Contract: [0x9D390dCa06118302C8194CC214Ed9BC7f5969810](https://explorer.testnet.arc.io/address/0x9D390dCa06118302C8194CC214Ed9BC7f5969810?tab=contract). Chain ID: 5042002. Native Arc USDC ERC-20 interface: `0x3600000000000000000000000000000000000000`. Explorer source verification returned **Pass - Verified**, and the source query confirms NomineClaimCore / Solidity v0.8.24+commit.e11b9ed9.

## Result

**Passed:** live deployment, runtime getters, funding, sponsored settlement, real-time expiry, issuer recovery, and canonical-event accounting. Compiler settings: optimizer 200, viaIR, Cancun. This build executed on the target testnet, not only a local mock.

Campaign 1 funded 0.30 test USDC for three unique entitlements. One settled for 0.10; 0.20 returned to the issuer after expiry. Remaining campaign escrow is zero. Total transaction gas cost: 0.057068475 test USDC. The recipient paid no gas and received exactly 0.10.

## Transactions

- deployment: [0xba4d60f953ea8d099dd2903ff29f86d2a531fbee81bf712fdc801db6d5183338](https://explorer.testnet.arc.io/tx/0xba4d60f953ea8d099dd2903ff29f86d2a531fbee81bf712fdc801db6d5183338)
- USDC allowance: [0xdafc3c734c71d3469f02895fa25ddd041c41889747c00ca73bb52ea5c152fbac](https://explorer.testnet.arc.io/tx/0xdafc3c734c71d3469f02895fa25ddd041c41889747c00ca73bb52ea5c152fbac)
- fund campaign: [0x3d7272fc643c6e9a4ecde9b2c4a95e38939ada0f116501f1e0c8f3e509c4d349](https://explorer.testnet.arc.io/tx/0x3d7272fc643c6e9a4ecde9b2c4a95e38939ada0f116501f1e0c8f3e509c4d349)
- sponsored settlement: [0xfa58f31ec8845179793e9bef29d122893d2ddd66b412f7cb3375f7b1bb90a8ea](https://explorer.testnet.arc.io/tx/0xfa58f31ec8845179793e9bef29d122893d2ddd66b412f7cb3375f7b1bb90a8ea)
- expiry recovery: [0xdbbc5289a4fa72897afcc06a05564835028ffa50a0ec60304c70cb2e27292b2c](https://explorer.testnet.arc.io/tx/0xdbbc5289a4fa72897afcc06a05564835028ffa50a0ec60304c70cb2e27292b2c)

## Checks

- live RPC constructor simulation and deployment cost bound
- deployed runtime getters
- reject issuer also approver [IssuerIsAnApprover]
- reject duplicate entitlements [InvalidEntitlementSet]
- reject underfunding [Error]
- all three entitlements fully funded
- reject before opening [CampaignNotOpen]
- issuer alone [InvalidResolverApproval]
- resolver alone [InvalidIssuerApproval]
- wallet substitution [ApprovalMismatch]
- fabricated root membership [EntitlementNotListed]
- expired approvals [ApprovalExpired]
- cross-chain consent replay [InvalidClaimantConsent]
- cross-contract consent replay [InvalidClaimantConsent]
- claimant receives exact allocation without paying gas
- double settlement replay [EntitlementAlreadyConsumed]
- early reclaim [NotExpired]
- settlement after expiry [CampaignExpired]
- non-issuer recovery [NotIssuer]
- unused balance recovered without gate signatures
- duplicate reclaim [CampaignReclaimedAlready]
- canonical event replay and conservation: 0.30 funded = 0.10 settled + 0.20 reclaimed

Negative cases used eth_call against the deployed contract and live Arc state; they were not broadcast failed transactions. Positive lifecycle steps above are mined transactions. Opening and expiry were real block timestamps; no time-travel RPC was used. The underfunding case exceeded the granted allowance and reverted at the token transfer.

## Actors and limits

- issuer: `0xe3C71da511A74b18ac41d4E19308aeEE980b98E1`
- issuerApprover: `0x60b9928868D89e1d16C24b4d8b0251f3E70FbC50`
- resolver: `0xa888e827D0395ab404BB424651E26019293c767d`
- claimant: `0x7B1fE526f09FE1aD9FD0C228AA9FEDd271e2c201`
- sponsor: `0xe3C71da511A74b18ac41d4E19308aeEE980b98E1`

The supplied deployer acted as campaign issuer and settlement sponsor. The supplied relayer wallet acted as claimant/recipient. Issuer-approval and Resolver keys were separately generated, ephemeral, in-memory test actors. Their private keys were not saved. This validates contract mechanics and signature separation, **not** the pilot operational requirement for an independently controlled issuer approval key or human verification through a known channel. That workflow remains to be demonstrated with the actual issuer.

No mainnet transaction was made, no backend/frontend production configuration was changed, and no custody security audit is claimed. The 41 local contract tests previously passed; this report adds target-network evidence for the exercised paths, not exhaustive Arc behavior (for example blocklist enforcement was not exercised).

## Reproduction

Use the recorded source commit and exact compiler settings; install locked dependencies, compile, and load test-only credentials locally without logging them. On chain 5042002, deploy with the USDC address above, approve 0.30 USDC, and create three random sorted entitlement identifiers with allocation 100000 base units, distinct approving addresses and short opening/expiry windows. Obtain claimant consent and both EIP-712 approvals, run rejected scenarios by static call, sponsor one valid settlement, wait for real expiry and reclaim. Reconcile only canonical Claim Core lifecycle events. Runtime evidence is in `arc-testnet-runtime.json`; the local operator runner is retained outside tracked application source.

Explorer verification uses the compiled standard JSON input, exact compiler version and ABI-encoded USDC constructor argument, submitted directly to `https://explorer.testnet.arc.io/api`. The older arcscan host redirects; use the canonical endpoint for POST requests.
