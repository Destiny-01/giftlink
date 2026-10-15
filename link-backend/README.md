# Nomine backend (`link-backend`)

The Express API behind Nomine. It prepares campaigns, verifies claimant consent, produces the approval and resolver signatures, relays `settle` on Arc, and indexes the `NomineClaimCore` events that are the source of truth for funding, settlement and reclaim.

**Stack:** Node.js, TypeScript, Express, Prisma + PostgreSQL, ethers v6, Privy (server auth), zod, pino.

## Run locally

```bash
yarn install
cp .env.example .env   # every variable is documented inline
yarn prisma:generate
npx prisma db push
yarn dev
```

| Script | |
|---|---|
| `yarn dev` | Watch mode via tsx |
| `yarn build` / `yarn start` | Compile to `dist/` and run |
| `yarn typecheck` | `tsc --noEmit` |
| `yarn test` | Node test runner over `test/**/*.test.ts` |

## Configuration

`src/config/env.ts` validates the environment at startup and refuses to boot on an inconsistent network:
- `ARC_NETWORK` must match `CHAIN_ID` (testnet `5042002`, mainnet `5042`).
- On mainnet, `ISSUER_ALLOWLIST` and the campaign caps are required, and legacy routes must be off.
- The resolver signer, relayer and optional auto-approver must be three distinct keys (D-021).

## Main routes (`/api`)

| Route | Purpose |
|---|---|
| `GET /config`, `GET /health` | Public network identity and liveness/indexer status |
| `GET /studio/access` | Whether the signed-in user may create campaigns |
| `POST /campaigns/prepare`, `POST /campaigns/:id/confirm` | Issuer prepares a campaign, then confirms it from the onchain funding event |
| `GET /campaigns`, `GET /campaigns/:id`, `GET /campaigns/:id/requests` | Issuer views |
| `GET /campaigns/:id/public` | Public campaign summary for claim links |
| `GET /inbox` | The signed-in claimant's entitlements |
| `POST /campaigns/:id/consent` | Claimant consent; in automatic mode this also approves and settles |
| `POST /campaigns/:id/requests/:requestId/issuer-approval` | Manual-mode issuer approval |
| `POST /campaigns/:id/requests/:requestId/settle` | Idempotent sponsored settlement |
| `POST /campaigns/:id/recover/confirm` | Record an issuer reclaim from its onchain event |

The `drops` and `stats` routes serve the legacy GiftLink MVP and are only mounted when `ENABLE_LEGACY_GIFTLINK=true`.

## Jobs

`claimIndexerJob` scans Claim Core events from `CLAIM_CORE_DEPLOY_BLOCK` in adaptive windows. It handles Arc RPC throttling with backoff and pacing.

See [`docs/nomine-claim-core-integration.md`](../docs/nomine-claim-core-integration.md) for the full contract between the backend, the frontend and the chain.
