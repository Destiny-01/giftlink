# Nomine web app (`link-gift-send`)

The Nomine frontend:
- **Landing** and **Roadmap**;
- **Studio**, where issuers create and fund campaigns and watch payouts;
- **Inbox** and **claim links**, where recipients claim in one click and get an explorer receipt.

**Stack:** React, Vite, TypeScript, Tailwind + shadcn/ui, Privy (email login and embedded wallets), wagmi/viem.

## Run locally

```bash
npm ci
cp .env.example .env
npm run dev
```

| Script | |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Node test runner over `tests/**/*.test.ts` |
| `npm run lint` | ESLint |

## Configuration

A single switch, `VITE_ARC_NETWORK` (`testnet` | `mainnet`), selects the network. Every other variable is required and has no default. If anything is missing or inconsistent, the app renders a "Configuration error" screen listing the variable names instead of starting. All variables are documented in [`.env.example`](.env.example) and parsed in `src/config/network.ts`.

Brand tokens and type come from [`brand/approved`](../brand/approved).
