/**
 * Test environment bootstrap.
 *
 * Must be required before any application module: `config/env.ts` validates the
 * environment at import time and exits the process on failure, and `config/wallets.ts`
 * refuses to start when a configured address does not match its private key.
 *
 * Everything here is a synthetic fixture. No real credential, identity or key appears in
 * this file or in any test, and none of these values are valid on any network.
 */
const { Wallet } = require("ethers") as typeof import("ethers");

const backendSigner = new Wallet("0x" + "11".repeat(32));
const relayer = new Wallet("0x" + "22".repeat(32));

export const TEST_CONTRACT_ADDRESS =
  "0x1111111111111111111111111111111111111111";
export const TEST_USDC_ADDRESS = "0x2222222222222222222222222222222222222222";
/**
 * Nomine Claim Core. Deliberately a distinct, synthetic address from the legacy GiftLink
 * contract so a test can prove nothing falls back from one to the other (§1).
 */
export const TEST_CLAIM_CORE_ADDRESS = "0x3333333333333333333333333333333333333333";
export const TEST_CHAIN_ID = 31337;

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/giftlink_test";
process.env.RPC_URL = "http://127.0.0.1:8545";
process.env.GIFTLINK_CONTRACT_ADDRESS = TEST_CONTRACT_ADDRESS;
process.env.CLAIM_CORE_CONTRACT_ADDRESS = TEST_CLAIM_CORE_ADDRESS;
/**
 * The block the (synthetic) Claim Core deployment was created at. The Arc testnet value is
 * used so the indexer tests exercise a realistic, non-zero scan floor.
 */
process.env.CLAIM_CORE_DEPLOY_BLOCK = "64110120";
process.env.USDC_CONTRACT_ADDRESS = TEST_USDC_ADDRESS;
process.env.CHAIN_ID = String(TEST_CHAIN_ID);
/**
 * The suite runs against the synthetic chain id above, which is not an Arc network. The
 * explicit network is still required, the test chain id is permitted only under
 * `NODE_ENV=test`, and legacy support stays on so the existing legacy tests still run.
 */
process.env.ARC_NETWORK = "testnet";
process.env.ENABLE_LEGACY_GIFTLINK = "true";
process.env.BACKEND_SIGNER_PRIVATE_KEY = "0x" + "11".repeat(32);
process.env.BACKEND_SIGNER_ADDRESS = backendSigner.address;
process.env.RELAYER_PRIVATE_KEY = "0x" + "22".repeat(32);
process.env.RELAYER_ADDRESS = relayer.address;
process.env.SERVER_PEPPER = "0x" + "33".repeat(32);
process.env.PRIVY_APP_ID = "cltest0000000000000000000";
process.env.PRIVY_APP_SECRET = "test-app-secret";
process.env.FRONTEND_URL = "http://localhost:5173";

/**
 * Synthetic wallets, derived from fixed test keys so the suite can actually sign the
 * claim challenge. Never funded, never used outside tests.
 */
export const RECIPIENT_WALLET_KEY = "0x" + "a1".repeat(32);
export const RECIPIENT_SECOND_WALLET_KEY = "0x" + "a2".repeat(32);
export const STRANGER_WALLET_KEY = "0x" + "b1".repeat(32);

/** A payout wallet that is linked to the synthetic recipient account. */
export const RECIPIENT_WALLET = new Wallet(RECIPIENT_WALLET_KEY).address.toLowerCase();
/** A second wallet on the same account: the "arbitrary first wallet" regression. */
export const RECIPIENT_SECOND_WALLET = new Wallet(
  RECIPIENT_SECOND_WALLET_KEY
).address.toLowerCase();
/** A wallet belonging to somebody else entirely. */
export const STRANGER_WALLET = new Wallet(STRANGER_WALLET_KEY).address.toLowerCase();

/** Synthetic private identity value. Never a real address or handle. */
export const RECIPIENT_EMAIL = "fixture-recipient@example.test";
export const RECIPIENT_DISCORD = "FixtureRecipient";
/**
 * Realistic provider data for a social account: the provider reports a numeric id *and* a
 * handle, while the gift form addresses recipients by handle.
 */
export const RECIPIENT_DISCORD_USER_ID = "998877665544332211";
export const RECIPIENT_TWITTER = "FixtureHandle";
export const RECIPIENT_TWITTER_USER_ID = "112233445566778899";

/**
 * A synthetic value shaped like a credential. Used to prove that it cannot reach a log
 * record or a response body, whatever a library puts in an error message.
 */
export const SENSITIVE_FIXTURE = "fixture-secret-token-84c1d9";

export interface TestAuthUser {
  userId: string;
  privyUserId: string;
  walletAddresses: string[];
  walletKinds: Record<string, "privy" | "external">;
  walletAddress: string | null;
  email: string | null;
  discordId: string | null;
  twitterId: string | null;
  telegramId: string | null;
  socialIdentifiers: {
    discord: string[];
    twitter: string[];
    telegram: string[];
  };
}

export function makeAuthUser(
  overrides: Partial<TestAuthUser> = {}
): TestAuthUser {
  const walletAddresses =
    overrides.walletAddresses ?? [RECIPIENT_WALLET.toLowerCase()];

  return {
    userId: "user_fixture_1",
    privyUserId: "did:privy:fixture1",
    walletAddresses,
    walletKinds: Object.fromEntries(
      walletAddresses.map((address) => [address, "privy" as const])
    ),
    walletAddress: walletAddresses[0] ?? null,
    email: RECIPIENT_EMAIL,
    discordId: RECIPIENT_DISCORD_USER_ID,
    twitterId: RECIPIENT_TWITTER_USER_ID,
    telegramId: null,
    socialIdentifiers: {
      discord: [RECIPIENT_DISCORD_USER_ID, RECIPIENT_DISCORD],
      twitter: [RECIPIENT_TWITTER_USER_ID, RECIPIENT_TWITTER],
      telegram: [],
    },
    ...overrides,
  };
}

/** A synthetic provider payload, shaped the way the identity provider reports one. */
export interface ProviderFixture {
  privyUserId?: string;
  email?: string | null;
  wallets?: string[];
  discord?: { userId?: string; username?: string; discriminator?: string };
  twitter?: { userId?: string; username?: string };
}

/**
 * Builds an authenticated user by running the **real** `extractIdentities` over a synthetic
 * provider payload.
 *
 * `makeAuthUser` hands the policy a hand-written candidate list, which cannot catch a mistake
 * in how candidates are derived from the provider. This goes through the production
 * extraction path, so what the policy is given is what the provider would really produce.
 *
 * The `require` is deliberately inside the function: this module must finish setting the
 * environment before any application module is loaded.
 */
export function makeAuthUserFromProvider(
  fixture: ProviderFixture = {}
): TestAuthUser {
  const { extractIdentities } = require("../src/services/authService") as typeof import("../src/services/authService");

  const wallets = fixture.wallets ?? [RECIPIENT_WALLET.toLowerCase()];
  const privyUserId = fixture.privyUserId ?? "did:privy:fixture1";

  const privyUser = {
    id: privyUserId,
    linkedAccounts: [
      ...wallets.map((address) => ({
        type: "wallet",
        address,
        walletClientType: "privy",
      })),
      ...(fixture.email === null
        ? []
        : [{ type: "email", address: fixture.email ?? RECIPIENT_EMAIL }]),
      ...(fixture.discord
        ? [
            {
              type: "discord_oauth",
              userId: fixture.discord.userId,
              username: fixture.discord.username,
              discriminator: fixture.discord.discriminator,
            },
          ]
        : []),
      ...(fixture.twitter
        ? [
            {
              type: "twitter_oauth",
              userId: fixture.twitter.userId,
              username: fixture.twitter.username,
            },
          ]
        : []),
    ],
  };

  const identities = extractIdentities(privyUser as never);

  return {
    userId: `row_${privyUserId}`,
    privyUserId,
    walletAddresses: identities.walletAddresses,
    walletKinds: identities.walletKinds,
    walletAddress: identities.walletAddress,
    email: identities.email,
    discordId: identities.discordId,
    twitterId: identities.twitterId,
    telegramId: identities.telegramId,
    socialIdentifiers: identities.socialIdentifiers,
  };
}

export interface TestDrop {
  id: string;
  onchainId: bigint | null;
  senderAddress: string;
  senderPrivyId: string | null;
  senderIdentifier: string | null;
  recipientType: "PUBLIC" | "EMAIL" | "DISCORD" | "TWITTER" | "WALLET";
  recipientIdentifier: string;
  recipientPrivyId: string | null;
  recipientCommit: string;
  amount: string;
  gasTankAmount: string | null;
  message: string | null;
  isAnonymous: boolean;
  status: "PENDING" | "ACTIVE" | "CLAIMED" | "REVOKED" | "EXPIRED";
  expiry: Date | null;
  creationTxHash: string | null;
  claimTxHash: string | null;
  revokeTxHash: string | null;
  claimerAddress: string | null;
  claimerIdentifier: string | null;
  relayerAddress: string | null;
  estimatedGasCost: string | null;
  senderWalletType: "EXTERNAL" | "PRIVY";
  claimerWalletType: "EXTERNAL" | "PRIVY" | null;
  createdAt: Date;
  claimedAt: Date | null;
  updatedAt: Date;
}

export const TEST_DROP_ID = "11111111-1111-4111-8111-111111111111";

export function makeDrop(overrides: Partial<TestDrop> = {}): TestDrop {
  return {
    id: TEST_DROP_ID,
    onchainId: 4242n,
    senderAddress: "0x9999999999999999999999999999999999999999",
    senderPrivyId: "did:privy:sender",
    senderIdentifier: null,
    recipientType: "EMAIL",
    recipientIdentifier: RECIPIENT_EMAIL,
    recipientPrivyId: "did:privy:fixture1",
    recipientCommit: "0x" + "00".repeat(32),
    // Human units, exactly as `prepareDrop` stores it ("5" USDC). The contract holds base
    // units, which is why every amount comparison converts through
    // `dropAmountToBaseUnits`.
    amount: "5",
    gasTankAmount: "5000000",
    message: null,
    isAnonymous: false,
    status: "ACTIVE",
    expiry: null,
    creationTxHash: null,
    claimTxHash: null,
    revokeTxHash: null,
    claimerAddress: null,
    claimerIdentifier: null,
    relayerAddress: null,
    estimatedGasCost: null,
    senderWalletType: "EXTERNAL",
    claimerWalletType: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    claimedAt: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}
