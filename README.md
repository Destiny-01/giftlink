# Nomine: value, addressed

Nomine lets you send USDC to people **before you know their wallet**. An issuer funds a campaign on Arc with USDC and a list of verified emails. Each recipient signs in with that email, presses **Claim**, and the USDC lands in their wallet. They need no gas, no existing wallet, and no forms.

- **Live (Arc mainnet):** https://www.usenomine.com
- **Testnet:** https://testnet.usenomine.com
- **Claim Core on Arc mainnet:** [`0x42F3b6dAFAEC1F5df5c7D44224633250fb97b710`](https://arc.etherscan.io/address/0x42F3b6dAFAEC1F5df5c7D44224633250fb97b710)
- **Claim Core on Arc testnet:** [`0x9D390dCa06118302C8194CC214Ed9BC7f5969810`](https://testnet.arcscan.app/address/0x9D390dCa06118302C8194CC214Ed9BC7f5969810) (source verified)

## Why

Paying people onchain usually starts with "send us your wallet address", which brings forms, spreadsheets, multisends and manual reconciliation. Nomine reverses the order. The money is escrowed first and addressed to an identity the issuer already has, and the destination wallet is chosen by the recipient at claim time.

## How it works

1. **Issuer funds a campaign.** In Studio, the issuer enters a list of emails, an amount per recipient and a claim window, then funds the campaign. USDC moves into the immutable `NomineClaimCore` escrow on Arc. Each recipient's entitlement is a Merkle leaf over a hashed email; no plaintext email ever goes onchain.
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

**Next:** CSV import, more Gates (GitHub, X, Discord), claim notifications, campaign analytics.
**Later:** recurring payouts, multi-chain claims, public issuer profiles.

Full roadmap: [usenomine.com/roadmap](https://www.usenomine.com/roadmap).

Built by [@usenomine](https://x.com/usenomine).
