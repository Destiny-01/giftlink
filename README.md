# Nomine: value, addressed

**Nomine simply makes value addressable.** It is the Claim Layer and economic inbox where anyone can reserve funded value for any person, group, condition or machine, and that value settles onchain, to whoever qualifies.

A **Claim** is capital escrowed up front, with five rules fixed before funding:
- **Capital:** what is reserved.
- **Gate:** who or what qualifies, proven onchain or attested by a named Resolver.
- **Availability:** when it can be claimed.
- **Settlement:** the approved outcome.
- **Recovery:** where unused value returns.

Anyone can fund Claims from Studio. Claimants find and settle everything addressed to them in the Inbox.

- **Live (Arc mainnet):** https://www.usenomine.com
- **Testnet:** https://testnet.usenomine.com
- **Claim Core on Arc mainnet:** [`0x42F3b6dAFAEC1F5df5c7D44224633250fb97b710`](https://arc.etherscan.io/address/0x42F3b6dAFAEC1F5df5c7D44224633250fb97b710)
- **Claim Core on Arc testnet:** [`0x9D390dCa06118302C8194CC214Ed9BC7f5969810`](https://testnet.arcscan.app/address/0x9D390dCa06118302C8194CC214Ed9BC7f5969810) (source verified)

## Why

Blockchains move value well when both ends are known: send 100 USDC from wallet A to wallet B. Real economic obligations rarely start that way. Refunds, grant milestones, bounties, contributor rewards and payments to agents are owed to someone defined by a condition, long before a destination is known.

Today one such obligation is split across unrelated systems:
- eligibility in spreadsheets and forms;
- money in a treasury;
- approvals in tickets and custom claim pages;
- reconciliation by hand.

Nothing binds the money to the rule for who gets it. A Claim does: one funded, inspectable object, from reservation to settlement or recovery.

> DEXes make assets exchangeable. Nomine makes value addressable.

## How it works today (V1 on Arc)

1. **Issuer funds a Claim program.** In Studio, the issuer sets the Gate (V1: verified emails), the amount per claimant and the claim window, then funds the program. USDC moves into the immutable `NomineClaimCore` escrow on Arc. Each recipient's entitlement is a Merkle leaf over a hashed email; no plaintext email ever goes onchain.
2. **Recipient claims.** The recipient signs in with that email through Privy, which also provides an embedded wallet, and presses **Claim**. They sign a free EIP-712 consent that names the payout wallet.
3. **Settlement.** The contract requires the claimant's consent signature plus two distinct authority signatures over the same approval: the issuer approver and the Nomine resolver. A relayer submits `settle` and pays the gas, and USDC moves from escrow to the recipient's wallet. Each entitlement can be settled at most once.
4. **Recovery.** After expiry, the issuer reclaims whatever was not claimed, directly from the contract.

**Approval modes:**
- **Automatic** (default): a Nomine-held approver key co-signs once the email is verified, so the recipient is paid in one click. Per-campaign budget and recipient caps bound the exposure.
- **Manual** (advanced): the issuer names their own approver wallet and co-signs every payout themselves.

See [`docs/DECISIONS.md`](docs/DECISIONS.md), D-019 and D-021.

## What Arc gives us

- **USDC as gas.** Issuers and the relayer hold one asset; there's no separate gas token to source.
- **Fast finality.** A claim lands in seconds, so the claimant sees "Paid" with a receipt in the same session.
- **Onchain lifecycle.** Funding, settlement and reclaim are canonical contract events. The backend indexes them and never marks anything paid without the event.

## Repository

| Path | What |
|---|---|
| [`link-contracts/`](link-contracts) | `NomineClaimCore.sol` (Solidity 0.8.24, OpenZeppelin 5): escrow, Merkle entitlements, EIP-712 consent and approvals, settle and reclaim. Hardhat tests, plus deployment records in `deployments/`. |
| [`link-backend/`](link-backend) | Express + Prisma + Postgres. Campaign preparation, consent and approval, the resolver and auto-approver signers, the sponsored relayer, and an Arc event indexer. |
| [`link-gift-send/`](link-gift-send) | React + Vite + Tailwind. Landing, Studio (issuers), Inbox (recipients), claim links, and the roadmap. |
| [`docs/`](docs) | Product, architecture and decision records. |

Each package's README covers setup. In brief:

```bash
cd link-contracts && npm ci && npx hardhat test
cd link-backend && yarn install && cp .env.example .env && yarn prisma:generate && yarn dev
cd link-gift-send && npm ci && cp .env.example .env && npm run dev
```

## Status

This is a pilot on Arc mainnet. Studio is invite-only, and campaigns are capped at 20 USDC and 10 recipients while we onboard issuers one at a time.

**Next:**
- more Gates (onchain holdings and roles, GitHub, X, Discord);
- a Claims API and embeds;
- CSV import, notifications and program analytics.

**Later:**
- milestone and recurring Claims;
- agent and machine Claims;
- richer settlement outcomes;
- private eligibility proofs;
- multi-chain.

Full roadmap: [usenomine.com/roadmap](https://www.usenomine.com/roadmap).

Built by [@usenomine](https://x.com/usenomine).
