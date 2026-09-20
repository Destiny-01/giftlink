# GiftLink Backend

Backend API for GiftLink, a commitment-based token drop system with social identity verification.

## Tech Stack

- Node.js + TypeScript
- Express
- Prisma + PostgreSQL
- Ethers.js
- Privy Auth
- Zod validation
- Pino logging

## Features

- **Drop Management** - Create, confirm, claim, and revoke token drops
- **Identity Verification** - Verify social identities (email, Discord, Twitter, Telegram) via Privy
- **Commitment System** - Secure recipient commitments using keccak256 hashing
- **EIP-712 Signing** - Issue signed permits for claim authorization
- **Gas Relaying** - Support for gasless claims via relayer
- **Background Jobs** - Auto-expire drops and sync on-chain transactions

## Project Structure

```
src/
 ├── index.ts              # Entry point
 ├── config/               # Configuration
 │    ├── env.ts
 │    ├── logger.ts
 │    ├── prisma.ts
 │    ├── privy.ts
 │    ├── wallets.ts
 │    ├── arcClient.ts
 │    └── abi.ts
 ├── controllers/          # Request handlers
 │    ├── dropController.ts
 │    └── userController.ts
 ├── services/             # Business logic
 │    ├── dropService.ts
 │    └── authService.ts
 ├── routes/               # API routes
 │    ├── drops.ts
 │    ├── users.ts
 │    ├── stats.ts
 │    └── index.ts
 ├── middleware/           # Express middleware
 │    ├── auth.ts
 │    ├── errorHandler.ts
 │    ├── logger.ts
 │    ├── rateLimiter.ts
 │    └── validator.ts
 ├── dto/                  # Zod schemas
 ├── jobs/                 # Background jobs
 │    ├── expireDropsJob.ts
 │    └── syncDropsJob.ts
 └── utils/                # Helpers
      ├── drop.ts
      ├── eip712.ts
      └── errors.ts
```

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL
- Ethereum RPC endpoint
- Privy app credentials

### Installation

```bash
yarn install
yarn prisma:generate
yarn prisma:migrate
```

### Environment Variables

Create a `.env` file:

```env
PORT=4000
DATABASE_URL=postgresql://user:password@localhost:5432/giftlink
RPC_URL=https://mainnet.infura.io/v3/your_key
GIFTLINK_CONTRACT_ADDRESS=0x...
USDC_CONTRACT_ADDRESS=0x...
CHAIN_ID=1
BACKEND_SIGNER_PRIVATE_KEY=0x...
BACKEND_SIGNER_ADDRESS=0x...
RELAYER_PRIVATE_KEY=0x...
RELAYER_ADDRESS=0x...
SERVER_PEPPER=0x...
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret
FRONTEND_URL=https://giftlink.app
EIP712_DOMAIN_NAME=GiftLinkPermit
EIP712_VERSION=1
ENABLE_EVENT_LISTENER=true
```

### Run

```bash
yarn dev    # Development
yarn build  # Build
yarn start  # Production
```

## API Endpoints

### Drops

- `POST /api/drops/prepare` - Create a pending drop
- `POST /api/drops/confirm` - Confirm drop after on-chain transaction
- `GET /api/drops/:id` - Get drop details
- `POST /api/drops/:id/claim-permit` - Get signed claim permit
- `POST /api/drops/:id/relay-claim` - Relay a claim transaction
- `POST /api/drops/:id/claimed` - Record successful claim
- `POST /api/drops/:id/update-receiver` - Update drop recipient
- `POST /api/drops/:id/revoke` - Revoke a drop

### Users

- `POST /api/users/authenticate` - Authenticate with Privy token
- `GET /api/users/:address/drops` - Get user's drops (sent/received)

### Stats

- `GET /api/stats/overview` - Platform statistics

## Scripts

```bash
yarn dev              # Dev server with hot reload
yarn build            # TypeScript compilation
yarn start            # Run production build
yarn prisma:generate  # Generate Prisma client
yarn prisma:migrate   # Run migrations
yarn prisma:studio    # Open Prisma Studio
```
