# GiftLink

**Send money like a link. No wallet needed.**

GiftLink makes sending crypto as simple as sharing a link. Send USDC to anyone—they claim instantly using email, social login, or a wallet. If they don't have a wallet, we create one automatically.

## Why It's Useful

Pay freelancers, send gifts, tip creators, reward customers, or split bills. Recipients don't need crypto knowledge—just click the link and claim.

## Key Features

- **Zero Fees for Recipients** - Recipients pay nothing. You cover the claim transaction upfront as a small gas reserve. They receive the full gift amount—no surprises.
- **Predictable Costs** - Built on Arc Network, gas is paid in USDC instead of volatile native tokens. This means stable, predictable fees calculated upfront. You know exactly what you'll pay before sending, making it reliable for business and personal use.
- **Walletless Onboarding** - Recipients claim via email, Twitter, Discord, or wallet. No crypto knowledge required.
- **Simple Sharing** - Create a link and share it anywhere.
- **Private or Public** - Send to specific recipients or make it first-come-first-served.

## Quick Start

```sh
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Start development server
npm run dev
```

The app will be available at `http://localhost:8080`

## Tech Stack

- React + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- Privy (authentication)
- Wagmi + Viem (wallet interactions)
- Arc Network (blockchain)

## Environment Variables

One switch, `VITE_ARC_NETWORK`, decides whether the build is testnet or mainnet. When any required
variable is missing or invalid, the app renders a "Configuration error" screen listing the variable
names and refuses to mount — it never falls back to a default network.

Required:

- `VITE_ARC_NETWORK` - `testnet` or `mainnet`; sets the chain ID (testnet `5042002`, mainnet `5042`).
- `VITE_ARC_RPC_URL` - Arc JSON-RPC endpoint.
- `VITE_ARC_EXPLORER_URL` - Block explorer base URL (a trailing slash is normalized away).
- `VITE_API_URL` - Backend API base URL.
- `VITE_CLAIM_CORE_ADDRESS` - Nomine Claim Core contract address (0x-address).
- `VITE_USDC_CONTRACT_ADDRESS` - Arc USDC ERC-20 contract address (0x-address).
- `VITE_PRIVY_APP_ID` - Privy app ID.

Optional:

- `VITE_ARC_CHAIN_ID` - when set, must equal the selected network's chain ID.
- `VITE_ENABLE_LEGACY_GIFTLINK` - `true` registers the legacy GiftLink MVP routes and links.
  Default `false` keeps the app on the Nomine-only surface (Inbox, Studio, campaign links).
- `VITE_GIFTLINK_CONTRACT_ADDRESS` - legacy GiftLink drop contract address.

See `.env.example` for a commented example.

## Building

```sh
npm run build
```
