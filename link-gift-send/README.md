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

Required:

- `VITE_ARC_RPC_URL` - Arc Network RPC endpoint
- `VITE_USDC_CONTRACT_ADDRESS` - USDC contract address
- `VITE_PRIVY_APP_ID` - Privy app ID

See `.env.example` for all options.

## Building

```sh
npm run build
```
