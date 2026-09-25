import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import {
  RECIPIENT_DISCORD,
  RECIPIENT_DISCORD_USER_ID,
  RECIPIENT_EMAIL,
  RECIPIENT_SECOND_WALLET,
  RECIPIENT_TWITTER,
  RECIPIENT_TWITTER_USER_ID,
  RECIPIENT_WALLET,
  RECIPIENT_WALLET_KEY,
  SENSITIVE_FIXTURE,
  STRANGER_WALLET,
  STRANGER_WALLET_KEY,
  TEST_CHAIN_ID,
  TEST_CONTRACT_ADDRESS,
  TEST_DROP_ID,
  TEST_USDC_ADDRESS,
  makeDrop,
} from "./setup";

const { computeRecipientCommit, recipientTypeToNumber } = require("../src/utils/drop") as typeof import("../src/utils/drop");
const { RecipientType } = require("@prisma/client") as typeof import("@prisma/client");
const { giftLinkInterface } = require("../src/config/abi") as typeof import("../src/config/abi");

/**
 * Synthetic credential and identity fixtures. If any of these strings reach a logger or a
 * response body, that is the failure this suite exists to catch. None of them is a real
 * credential, address or handle.
 */
const SYNTHETIC_IDENTITY_TOKEN = "synthetic-identity-token-fixture-0001";
const STRANGER_EMAIL = "fixture-stranger@example.test";
const STRANGER_PRIVY_ID = "did:privy:fixture-stranger";
const RECIPIENT_PRIVY_ID = "did:privy:fixture1";
const STRANGER_TOKEN = "token-stranger";
const RECIPIENT_TOKEN = "token-recipient";

const SETTLEMENT_TX_HASH = "0x" + "ee".repeat(32);
const CREATION_TX_HASH = "0x" + "cc".repeat(32);
const RELAYER_ADDRESS = "0xbbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";
const SENDER_TOKEN = "token-sender";
const SENDER_PRIVY_ID = "did:privy:sender";
/** The gift is 5 USDC: the database stores "5", the contract holds 5_000_000. */
const GIFT_BASE_UNITS = 5_000_000n;

// ---- Capture every log record, and keep the log output out of the test transcript ----
const logRecords: string[] = [];
const loggerModule = require("../src/config/logger") as typeof import("../src/config/logger");
for (const level of ["info", "warn", "error", "debug", "fatal", "trace"] as const) {
  (loggerModule.logger as unknown as Record<string, unknown>)[level] = (
    ...args: unknown[]
  ) => {
    logRecords.push(JSON.stringify(args));
  };
}

// ---- Fixtures ----
function recipientDrop() {
  const drop = makeDrop({
    recipientType: "EMAIL",
    recipientIdentifier: RECIPIENT_EMAIL,
    recipientPrivyId: RECIPIENT_PRIVY_ID,
  });
  drop.recipientCommit = computeRecipientCommit(
    RecipientType.EMAIL,
    RECIPIENT_EMAIL,
    drop.id
  );
  return drop;
}

let currentDrop = recipientDrop();
let settlementBehaviour: "valid" | "unrelated" | "amount_mismatch" = "valid";
let creationBehaviour: "valid" | "wrong_commit" | "unrelated_sender" = "valid";
let giftStatus = 0;
const settlementWrites: { data: Record<string, unknown> }[] = [];
const dropUpdates: { data: Record<string, unknown> }[] = [];

interface SyntheticAccount {
  privyUserId: string;
  email: string | null;
  wallets: string[];
  /**
   * Realistic provider payloads: a social linked account carries its own numeric id *and* a
   * handle, which is precisely the mismatch that used to reject correctly authenticated
   * recipients addressed by handle.
   */
  discord?: { userId: string; username: string; discriminator?: string };
  twitter?: { userId: string; username: string };
}

const accountsByToken: Record<string, SyntheticAccount> = {
  [SENDER_TOKEN]: {
    privyUserId: SENDER_PRIVY_ID,
    email: "fixture-sender@example.test",
    wallets: [currentDrop.senderAddress],
  },
  [RECIPIENT_TOKEN]: {
    privyUserId: RECIPIENT_PRIVY_ID,
    email: RECIPIENT_EMAIL,
    wallets: [RECIPIENT_WALLET, RECIPIENT_SECOND_WALLET],
    discord: {
      userId: RECIPIENT_DISCORD_USER_ID,
      username: RECIPIENT_DISCORD,
      discriminator: "1234",
    },
    twitter: {
      userId: RECIPIENT_TWITTER_USER_ID,
      username: RECIPIENT_TWITTER,
    },
  },
  [STRANGER_TOKEN]: {
    privyUserId: STRANGER_PRIVY_ID,
    email: STRANGER_EMAIL,
    wallets: [STRANGER_WALLET],
  },
};

/**
 * The identity provider is the one seam the real code cannot do without in a test. Its
 * client object is shared, so replacing these methods exercises the real
 * `syncUserFromPrivy` and `extractIdentities` code rather than a stub of them.
 *
 * (Module exports themselves are not patchable here: the CommonJS transform defines them
 * as non-configurable getters, so replacing an exported function silently does nothing.)
 */
const privyModule = require("../src/config/privy") as typeof import("../src/config/privy");
(privyModule.privyClient as unknown as Record<string, unknown>).getUser = async ({
  idToken,
}: {
  idToken: string;
}) => {
  const account = accountsByToken[idToken];
  if (!account) {
    throw new Error("unknown synthetic identity token");
  }

  return {
    id: account.privyUserId,
    linkedAccounts: [
      ...account.wallets.map((address) => ({
        type: "wallet",
        address,
        walletClientType: "privy",
      })),
      ...(account.email
        ? [{ type: "email", address: account.email }]
        : []),
      ...(account.discord
        ? [
            {
              type: "discord_oauth",
              userId: account.discord.userId,
              username: account.discord.username,
              discriminator: account.discord.discriminator,
            },
          ]
        : []),
      ...(account.twitter
        ? [
            {
              type: "twitter_oauth",
              userId: account.twitter.userId,
              username: account.twitter.username,
            },
          ]
        : []),
    ],
  };
};

/** Identity rows are persisted on the way through; return the row the middleware reads. */
const prismaModule = require("../src/config/prisma") as typeof import("../src/config/prisma");
const prisma = prismaModule.prisma as unknown as Record<string, any>;

prisma.user.upsert = async ({ where }: { where: { privyId: string } }) => {
  const account = Object.values(accountsByToken).find(
    (candidate) => candidate.privyUserId === where.privyId
  );
  return {
    id: `row_${where.privyId}`,
    privyId: where.privyId,
    walletAddress: account?.wallets[0]?.toLowerCase() ?? null,
    email: account?.email ?? null,
    discordId: null,
    twitterId: null,
    telegramId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
};
prisma.user.findUnique = async () => null;
prisma.user.findFirst = async () => null;
prisma.drop.findUnique = async () => {
  if (dropLookupFailure) {
    throw dropLookupFailure;
  }
  return currentDrop;
};
prisma.drop.findFirst = async () => null;
prisma.drop.update = async (args: { data: Record<string, unknown> }) => {
  dropUpdates.push(args);
  return currentDrop;
};
prisma.drop.updateMany = async (args: { data: Record<string, unknown> }) => {
  settlementWrites.push(args);
  return { count: 1 };
};
prisma.dropEvent.create = async () => ({});
prisma.dropEvent.findFirst = async () => null;
prisma.socialIdentity.upsert = async () => ({});
prisma.$transaction = async (arg: unknown) =>
  typeof arg === "function"
    ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
    : Promise.all(arg as Promise<unknown>[]);

/** Counts how far down the chain-verification path a request got. */
let chainNetworkChecks = 0;

/**
 * Deployment and persistence faults, so the regression cases can prove the code fails closed
 * (and stays quiet about it) instead of trusting a mismatched chain or a library's message.
 */
let networkBehaviour: "valid" | "wrong_chain" = "valid";
let contractConfigBehaviour: "valid" | "wrong_usdc" = "valid";
let dropLookupFailure: Error | null = null;
/** How the claim submission itself behaves when it reaches the contract. */
let relaySubmitBehaviour: "ok" | "mined_revert" = "ok";
/** The relayer's native balance. Zero stops the relay flow before it submits anything. */
let relayerBalance = 0n;

/**
 * The RPC endpoint is the second seam. Stubbing the provider's own methods means the real
 * ABI decoding, event matching and authorization code all still run.
 */
const arcModule = require("../src/config/arcClient") as typeof import("../src/config/arcClient");
const provider = arcModule.getRpcProvider() as unknown as Record<string, any>;
const signerAddress = (require("../src/config/wallets") as typeof import("../src/config/wallets")).backendSigner.address;

provider.getNetwork = async () => {
  chainNetworkChecks += 1;
  return {
    chainId:
      networkBehaviour === "wrong_chain"
        ? BigInt(TEST_CHAIN_ID + 1)
        : BigInt(TEST_CHAIN_ID),
    name: "test",
  };
};
// A zero relayer balance stops the relay flow at the last gate before sending.
provider.getBalance = async () => relayerBalance;
/**
 * Submission. A transaction that is mined and then reverts is the case worth stubbing: ethers
 * reports it with the failed receipt and **no reason at all**, so a reason-only check would
 * treat it as an unknown failure and never try to recover the settlement that may exist.
 */
provider.estimateGas = async () => 21_000n;
// The signer populates the transaction before signing, so the submission path also needs the
// nonce and the fee data; without them it fails before it ever reaches the contract.
provider.getTransactionCount = async () => 1;
provider.getFeeData = async () => ({
  gasPrice: 1_000_000_000n,
  maxFeePerGas: 1_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
});
provider.broadcastTransaction = async () => ({
  hash: SETTLEMENT_TX_HASH,
  wait: async () => {
    if (relaySubmitBehaviour === "mined_revert") {
      throw Object.assign(new Error("transaction execution reverted"), {
        code: "CALL_EXCEPTION",
        receipt: { status: 0 },
      });
    }
    throw new Error("unexpected mined transaction in test");
  },
});
provider.getBlock = async () => ({ timestamp: 1_770_000_000 });
provider.getBlockNumber = async () => 500;
// Log queries back the "already settled, recover it" path, which reads the settlement the
// contract recorded rather than trusting a retry.
provider.send = async (method: string) => {
  if (method === "eth_getLogs") {
    // JSON-RPC shape: numbers as hex strings, `logIndex` rather than `index`.
    return [
      {
        address: TEST_CONTRACT_ADDRESS,
        ...giftLinkInterface.encodeEventLog(
          giftLinkInterface.getEvent("DropClaimed")!,
          [4242n, RECIPIENT_WALLET, RELAYER_ADDRESS, GIFT_BASE_UNITS, 5_000_000n]
        ),
        blockNumber: "0x141",
        transactionHash: SETTLEMENT_TX_HASH,
        transactionIndex: "0x0",
        blockHash: "0x" + "aa".repeat(32),
        logIndex: "0x0",
        removed: false,
      },
    ];
  }

  throw new Error(`unexpected RPC method in test: ${method}`);
};
provider.getTransactionReceipt = async (hash: string) => {
  if (hash === CREATION_TX_HASH) {
    return {
      hash,
      status: 1,
      blockNumber: 100,
      logs: [
        {
          address: TEST_CONTRACT_ADDRESS,
          ...giftLinkInterface.encodeEventLog(
            giftLinkInterface.getEvent("DropCreated")!,
            [
              4242n,
              creationBehaviour === "unrelated_sender"
                ? "0xffff9999ffff9999ffff9999ffff9999ffff9999"
                : currentDrop.senderAddress,
              GIFT_BASE_UNITS,
              5_000_000n,
              creationBehaviour === "wrong_commit"
                ? "0x" + "ab".repeat(32)
                : currentDrop.recipientCommit,
              1,
              0n,
            ]
          ),
          index: 0,
          transactionHash: hash,
          blockNumber: 100,
        },
      ],
    };
  }

  if (settlementBehaviour === "unrelated") {
    return {
      hash: SETTLEMENT_TX_HASH,
      status: 1,
      blockNumber: 321,
      logs: [
        {
          address: TEST_CONTRACT_ADDRESS,
          ...giftLinkInterface.encodeEventLog(
            giftLinkInterface.getEvent("DropClaimed")!,
            [9999n, RECIPIENT_WALLET, RELAYER_ADDRESS, GIFT_BASE_UNITS, 5_000_000n]
          ),
          index: 0,
          transactionHash: SETTLEMENT_TX_HASH,
          blockNumber: 321,
        },
      ],
    };
  }

  return {
    hash: SETTLEMENT_TX_HASH,
    status: 1,
    blockNumber: 321,
    logs: [
      {
        address: TEST_CONTRACT_ADDRESS,
        ...giftLinkInterface.encodeEventLog(
          giftLinkInterface.getEvent("DropClaimed")!,
          [
            4242n,
            RECIPIENT_WALLET,
            RELAYER_ADDRESS,
            settlementBehaviour === "amount_mismatch"
              ? GIFT_BASE_UNITS + 1n
              : GIFT_BASE_UNITS,
            5_000_000n,
          ]
        ),
        index: 0,
        transactionHash: SETTLEMENT_TX_HASH,
        blockNumber: 321,
      },
    ],
  };
};
provider.call = async (tx: { data?: string }) => {
  const selector = String(tx.data ?? "").slice(0, 10);

  if (selector === giftLinkInterface.getFunction("USDC")!.selector) {
    return giftLinkInterface.encodeFunctionResult("USDC", [
      contractConfigBehaviour === "wrong_usdc"
        ? "0x" + "77".repeat(20)
        : TEST_USDC_ADDRESS,
    ]);
  }
  if (selector === giftLinkInterface.getFunction("backendSigner")!.selector) {
    return giftLinkInterface.encodeFunctionResult("backendSigner", [
      signerAddress,
    ]);
  }
  if (selector === giftLinkInterface.getFunction("getDrop")!.selector) {
    // The contract holds base units while the database holds the sender's human units, so
    // this stub performs the same real conversion production does. Mirroring
    // `currentDrop.amount` here instead would hide a unit mismatch in the comparison.
    return giftLinkInterface.encodeFunctionResult("getDrop", [
      currentDrop.senderAddress,
      BigInt(currentDrop.amount) * 10n ** 6n,
      BigInt(currentDrop.gasTankAmount ?? "0"),
      currentDrop.recipientCommit,
      recipientTypeToNumber(currentDrop.recipientType),
      giftStatus,
      currentDrop.expiry ? BigInt(Math.floor(currentDrop.expiry.getTime() / 1000)) : 0n,
      0n,
    ]);
  }

  throw new Error(`unexpected contract call in test: ${selector}`);
};

// ---- Start the real application ----
const { createApp } = require("../src/app") as typeof import("../src/app");

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
});

function post(path: string, token?: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
}

const ONCHAIN_GIFT_ID = 4242n;

/**
 * Signs exactly the challenge the client signs, so the wallet-control gate can pass with a
 * real signature instead of a placeholder.
 */
async function relayBody(
  address: string,
  privateKey: string,
  timestamp?: number
) {
  const issuedAt = timestamp ?? Math.floor(Date.now() / 1000);
  const message = `GiftLink Claim Authorization
Drop ID: ${ONCHAIN_GIFT_ID}
Claimer: ${address}
Timestamp: ${issuedAt}`;

  const { Wallet } = require("ethers") as typeof import("ethers");

  return {
    claimer: address,
    claimerSignature: await new Wallet(privateKey).signMessage(message),
    timestamp: issuedAt,
  };
}

/**
 * The routes under test are rate limited, and this suite deliberately makes many claim
 * attempts from one address. Clearing the counters between cases keeps each case independent
 * instead of measuring the previous ones.
 */
const rateLimiters = require("../src/middleware/rateLimiter") as typeof import("../src/middleware/rateLimiter");
const chainEvidenceModule = require("../src/services/chainEvidence") as typeof import("../src/services/chainEvidence");

function clearRateLimits() {
  for (const limiter of [
    rateLimiters.claimPermitLimiter,
    rateLimiters.dropMutationLimiter,
  ]) {
    const resettable = limiter as unknown as {
      store?: { resetAll?: () => void };
      resetKey?: (key: string) => void;
    };

    if (resettable.store?.resetAll) {
      resettable.store.resetAll();
    } else {
      for (const key of ["127.0.0.1", "::ffff:127.0.0.1", "::1"]) {
        resettable.resetKey?.(key);
      }
    }
  }
}

const reset = () => {
  currentDrop = recipientDrop();
  settlementBehaviour = "valid";
  creationBehaviour = "valid";
  giftStatus = 0;
  networkBehaviour = "valid";
  contractConfigBehaviour = "valid";
  dropLookupFailure = null;
  relaySubmitBehaviour = "ok";
  relayerBalance = 0n;
  settlementWrites.length = 0;
  dropUpdates.length = 0;
  chainNetworkChecks = 0;
  clearRateLimits();
  // The deployed-contract view is cached in production (with a TTL), so a case that changes
  // what the deployment reports has to start from an empty cache.
  chainEvidenceModule.resetContractViewCache();
};

/** A wallet-targeted gift: the payout address is the sender's chosen address. */
function walletTargetedDrop() {
  const drop = makeDrop({
    recipientType: "WALLET",
    recipientIdentifier: RECIPIENT_WALLET.toLowerCase(),
  });
  drop.recipientCommit = computeRecipientCommit(
    RecipientType.WALLET,
    RECIPIENT_WALLET.toLowerCase(),
    drop.id
  );
  return drop;
}

/** A public gift: first-claim-wins, addressed to nobody in particular. */
function publicGift() {
  const drop = makeDrop({
    recipientType: "PUBLIC",
    recipientIdentifier: "",
  });
  drop.recipientCommit = computeRecipientCommit(
    RecipientType.PUBLIC,
    "",
    drop.id
  );
  return drop;
}

describe("relay claim endpoint", () => {
  test("an unauthenticated caller is refused and never reaches the chain layer", async () => {
    reset();
    const response = await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      undefined,
      await relayBody(RECIPIENT_WALLET, RECIPIENT_WALLET_KEY)
    );

    assert.equal(response.status, 401);
    assert.equal(chainNetworkChecks, 0, "refused only after reaching the chain layer");
  });

  test("an unrelated authenticated identity is refused before anything is signed", async () => {
    reset();

    const response = await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      STRANGER_TOKEN,
      await relayBody(STRANGER_WALLET, STRANGER_WALLET_KEY)
    );

    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { message: string } };
    assert.match(body.error.message, /addressed to a different recipient/);
    // Nothing past authorization ran, so no permit was produced and no gas was spent.
    assert.equal(chainNetworkChecks, 0, "advanced past authorization");
  });

  test("the intended recipient is refused when the payout wallet is not theirs", async () => {
    reset();

    const response = await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      RECIPIENT_TOKEN,
      // A valid signature from a wallet that is not linked to the recipient's account:
      // control is proven, but the payout wallet is still not the recipient's.
      await relayBody(STRANGER_WALLET, STRANGER_WALLET_KEY)
    );

    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { message: string } };
    assert.match(body.error.message, /not linked to your account/);
    assert.equal(chainNetworkChecks, 0, "advanced past authorization");
  });

  test("the intended recipient passes authorization and reaches the deployment checks", async () => {
    reset();

    const response = await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      RECIPIENT_TOKEN,
      await relayBody(RECIPIENT_WALLET, RECIPIENT_WALLET_KEY)
    );

    // The stubbed zero relayer balance stops the flow at the last gate before sending,
    // which proves the recipient policy, the deployment check and the chain comparison all
    // passed for the legitimate claimant.
    assert.equal(response.status, 503);
    assert.ok(chainNetworkChecks > 0, "never reached the chain checks");
  });

  test("a stale challenge is rejected locally, before any chain interaction", async () => {
    reset();

    const response = await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      STRANGER_TOKEN,
      await relayBody(
        STRANGER_WALLET,
        STRANGER_WALLET_KEY,
        Math.floor(Date.now() / 1000) - 60 * 60
      )
    );

    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: { message: string } };
    assert.match(body.error.message, /too old/);
    assert.equal(chainNetworkChecks, 0, "a stale challenge reached the chain layer");
  });
});

describe("permit endpoint enforces the same policy", () => {
  test("an unrelated authenticated identity cannot obtain a permit", async () => {
    reset();

    const response = await post(`/api/drops/${TEST_DROP_ID}/claim-permit`, STRANGER_TOKEN, {
      claimerAddress: STRANGER_WALLET,
      walletType: "external",
    });

    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { message: string } };
    assert.match(body.error.message, /addressed to a different recipient/);
    assert.equal(chainNetworkChecks, 0, "advanced past authorization");
  });

  test("asserting the recipient's identifier in the request body changes nothing", async () => {
    reset();

    const response = await post(`/api/drops/${TEST_DROP_ID}/claim-permit`, STRANGER_TOKEN, {
      claimerAddress: STRANGER_WALLET,
      claimerIdentifier: RECIPIENT_EMAIL,
      walletType: "external",
    });

    // The identity that authorizes a claim comes from the provider, never from the body.
    assert.equal(response.status, 403);
  });

  test("the intended recipient is authorized, and a second linked wallet still works", async () => {
    reset();

    const response = await post(`/api/drops/${TEST_DROP_ID}/claim-permit`, RECIPIENT_TOKEN, {
      claimerAddress: RECIPIENT_SECOND_WALLET,
      walletType: "privy",
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      signature: string;
      permit: { claimer: string };
    };
    assert.ok(body.signature.startsWith("0x"));
    assert.equal(body.permit.claimer, RECIPIENT_SECOND_WALLET);
  });
});

describe("settlement recording", () => {
  test("an unrelated successful transaction cannot mark a gift claimed", async () => {
    reset();
    settlementBehaviour = "unrelated";

    const response = await post(`/api/drops/${TEST_DROP_ID}/claimed`, RECIPIENT_TOKEN, {
      txHash: SETTLEMENT_TX_HASH,
      claimerAddress: RECIPIENT_WALLET,
      walletType: "privy",
    });

    assert.equal(response.status, 409);
    assert.equal(settlementWrites.length, 0, "a write happened for unverified evidence");
  });

  test("a verified settlement reconciles a stale local expiry status", async () => {
    reset();
    // The chain says settled while this row still says expired.
    currentDrop = { ...recipientDrop(), status: "EXPIRED" as const };

    const response = await post(`/api/drops/${TEST_DROP_ID}/claimed`, RECIPIENT_TOKEN, {
      txHash: SETTLEMENT_TX_HASH,
      claimerAddress: RECIPIENT_WALLET,
      walletType: "privy",
    });

    assert.equal(response.status, 200);
    assert.equal(settlementWrites.length, 1);

    // Every recorded fact comes from the decoded event, not from the request.
    const write = settlementWrites[0];
    assert.equal(write.data.status, "CLAIMED");
    assert.equal(write.data.claimTxHash, SETTLEMENT_TX_HASH);
    assert.equal(write.data.claimerAddress, RECIPIENT_WALLET.toLowerCase());
    assert.equal(write.data.relayerAddress, RELAYER_ADDRESS);
    assert.equal(write.data.claimerWalletType, "PRIVY");
  });

  test("a repeated confirmation of the same settlement converges", async () => {
    reset();
    currentDrop = {
      ...recipientDrop(),
      status: "CLAIMED" as const,
      claimTxHash: SETTLEMENT_TX_HASH,
    };

    const response = await post(`/api/drops/${TEST_DROP_ID}/claimed`, RECIPIENT_TOKEN, {
      txHash: SETTLEMENT_TX_HASH,
      claimerAddress: RECIPIENT_WALLET,
      walletType: "privy",
    });

    assert.equal(response.status, 200);
    assert.equal(settlementWrites.length, 0, "a duplicate settlement record was written");
  });

  test("a settlement whose amount does not match the gift is refused", async () => {
    reset();
    settlementBehaviour = "amount_mismatch";

    const response = await post(`/api/drops/${TEST_DROP_ID}/claimed`, RECIPIENT_TOKEN, {
      txHash: SETTLEMENT_TX_HASH,
      claimerAddress: RECIPIENT_WALLET,
      walletType: "privy",
    });

    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: { message: string } };
    assert.match(body.error.message, /does not match the gift/);
    assert.equal(settlementWrites.length, 0, "a write happened for a mismatched amount");
  });

  test("an unrelated account cannot attach someone else's settlement", async () => {
    reset();

    const response = await post(`/api/drops/${TEST_DROP_ID}/claimed`, STRANGER_TOKEN, {
      txHash: SETTLEMENT_TX_HASH,
      claimerAddress: RECIPIENT_WALLET,
      walletType: "privy",
    });

    // The settlement is real and names this gift, but the caller is not the claimant.
    assert.equal(response.status, 403);
    assert.equal(settlementWrites.length, 0, "a stranger wrote a settlement record");
  });
});

describe("expiry-only recovery and relay retries", () => {
  test("a submission that reverts because the gift is gone recovers the real settlement", async () => {
    reset();
    // The retry raced an earlier attempt: the gift is already settled on-chain, so this
    // submission is mined and reverts, carrying no reason to match on.
    relaySubmitBehaviour = "mined_revert";
    relayerBalance = 10n ** 18n;

    const response = await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      RECIPIENT_TOKEN,
      await relayBody(RECIPIENT_WALLET, RECIPIENT_WALLET_KEY)
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as { txHash: string };
    assert.equal(body.txHash, SETTLEMENT_TX_HASH);
    // Converged onto the settlement the contract already holds, exactly once.
    assert.equal(settlementWrites.length, 1);
    assert.equal(settlementWrites[0].data.claimTxHash, SETTLEMENT_TX_HASH);
  });

  test("a relay retry after a chain success converges without a second payout", async () => {
    reset();
    // The previous attempt landed but its response never arrived, so the contract reports
    // the gift as claimed and the retry must recover rather than submit again.
    giftStatus = 1;

    const response = await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      RECIPIENT_TOKEN,
      await relayBody(RECIPIENT_WALLET, RECIPIENT_WALLET_KEY)
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as { txHash: string };
    assert.equal(body.txHash, SETTLEMENT_TX_HASH);
    // One record, written from the existing canonical event.
    assert.equal(settlementWrites.length, 1);
  });

  test("a retry is refused when the gift was settled to somebody else", async () => {
    reset();
    giftStatus = 1;

    const response = await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      STRANGER_TOKEN,
      await relayBody(STRANGER_WALLET, STRANGER_WALLET_KEY)
    );

    assert.equal(response.status, 403);
    assert.equal(settlementWrites.length, 0);
  });
});

describe("creation confirmation", () => {
  const pendingDrop = () => ({
    ...recipientDrop(),
    status: "PENDING" as const,
    onchainId: null,
    creationTxHash: null,
    senderPrivyId: SENDER_PRIVY_ID,
  });

  const confirmBody = () => ({
    dropId: TEST_DROP_ID,
    onchainId: "4242",
    txHash: CREATION_TX_HASH,
  });

  test("the funding event confirms the gift and binds the on-chain id", async () => {
    reset();
    currentDrop = pendingDrop();

    const response = await post("/api/drops/confirm", SENDER_TOKEN, confirmBody());

    assert.equal(response.status, 200);
    assert.equal(dropUpdates.length, 1);
    assert.equal(dropUpdates[0].data.status, "ACTIVE");
    assert.equal(dropUpdates[0].data.onchainId, 4242n);
    // The stored sender comes from the verified event, not from the request.
    assert.equal(
      dropUpdates[0].data.senderAddress,
      currentDrop.senderAddress
    );
  });

  test("a funding event for a different commitment cannot confirm this gift", async () => {
    reset();
    currentDrop = pendingDrop();
    creationBehaviour = "wrong_commit";

    const response = await post("/api/drops/confirm", SENDER_TOKEN, confirmBody());

    assert.equal(response.status, 409);
    assert.equal(dropUpdates.length, 0, "a forged mapping was recorded");
  });

  test("a funding event from a wallet the creator does not control is refused", async () => {
    reset();
    currentDrop = pendingDrop();
    creationBehaviour = "unrelated_sender";

    const response = await post("/api/drops/confirm", SENDER_TOKEN, confirmBody());

    assert.equal(response.status, 403);
    assert.equal(dropUpdates.length, 0);
  });

  test("an already-bound gift is not silently rebound to another on-chain id", async () => {
    reset();
    currentDrop = {
      ...pendingDrop(),
      onchainId: 999n,
      status: "ACTIVE" as const,
    };

    const response = await post("/api/drops/confirm", SENDER_TOKEN, {
      ...confirmBody(),
      onchainId: "4242",
    });

    assert.equal(response.status, 409);
    assert.equal(dropUpdates.length, 0);
  });

  test("a confirmation from the wrong chain binds nothing", async () => {
    reset();
    currentDrop = pendingDrop();
    networkBehaviour = "wrong_chain";

    const response = await post("/api/drops/confirm", SENDER_TOKEN, confirmBody());

    assert.equal(response.status, 503);
    assert.equal(dropUpdates.length, 0, "a record was bound from the wrong chain");
  });

  test("a confirmation against a mismatched deployment binds nothing", async () => {
    reset();
    currentDrop = pendingDrop();
    contractConfigBehaviour = "wrong_usdc";

    const response = await post("/api/drops/confirm", SENDER_TOKEN, confirmBody());

    assert.equal(response.status, 503);
    assert.equal(dropUpdates.length, 0);
  });
});

describe("signature-only access is preserved where the policy allows it", () => {
  test("an unauthenticated caller with a valid signature can claim a wallet-targeted gift", async () => {
    reset();
    currentDrop = walletTargetedDrop();

    const response = await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      undefined,
      await relayBody(RECIPIENT_WALLET, RECIPIENT_WALLET_KEY)
    );

    // It gets past authorization and the deployment checks, and stops at the relayer balance
    // gate rather than at an access check. `getNetwork` is the counter: one call means the
    // deployment was consulted at all.
    assert.ok(chainNetworkChecks > 0, "did not reach the deployment checks");
    assert.equal(response.status, 503);
  });

  test("an unauthenticated caller with a valid signature can claim a public gift", async () => {
    reset();
    currentDrop = publicGift();

    const response = await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      undefined,
      await relayBody(RECIPIENT_WALLET, RECIPIENT_WALLET_KEY)
    );

    assert.ok(chainNetworkChecks > 0, "did not reach the deployment checks");
    assert.equal(response.status, 503);
  });

  test("an unauthenticated caller cannot claim an identity-targeted gift", async () => {
    reset();

    const response = await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      undefined,
      await relayBody(RECIPIENT_WALLET, RECIPIENT_WALLET_KEY)
    );

    assert.equal(response.status, 401);
    assert.equal(chainNetworkChecks, 0, "reached the chain layer without an identity");
  });

  test("a token that is present but invalid is rejected rather than ignored", async () => {
    reset();

    const response = await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      "token-not-a-real-session",
      await relayBody(RECIPIENT_WALLET, RECIPIENT_WALLET_KEY)
    );

    assert.equal(response.status, 401);
    assert.equal(chainNetworkChecks, 0);
  });
});

describe("a gift addressed by social handle", () => {
  test("the owning account can claim it through the real route", async () => {
    reset();
    currentDrop = makeDrop({
      recipientType: "DISCORD",
      recipientIdentifier: `${RECIPIENT_DISCORD}#1234`.toLowerCase(),
      recipientPrivyId: null,
    });
    currentDrop.recipientCommit = computeRecipientCommit(
      RecipientType.DISCORD,
      `${RECIPIENT_DISCORD}#1234`.toLowerCase(),
      currentDrop.id
    );

    const response = await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      RECIPIENT_TOKEN,
      await relayBody(RECIPIENT_WALLET, RECIPIENT_WALLET_KEY)
    );

    // The recipient signed up after the gift was created, so no privy id was stored on it.
    assert.equal(currentDrop.recipientPrivyId, null);
    assert.ok(
      chainNetworkChecks > 0,
      "authorization was refused for the handle owner"
    );
    assert.equal(response.status, 503);
  });

  test("a handle that is not the caller's is refused", async () => {
    reset();
    currentDrop = makeDrop({
      recipientType: "TWITTER",
      recipientIdentifier: "@somebodyelse",
    });
    currentDrop.recipientCommit = computeRecipientCommit(
      RecipientType.TWITTER,
      "@somebodyelse",
      currentDrop.id
    );

    const response = await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      RECIPIENT_TOKEN,
      await relayBody(RECIPIENT_WALLET, RECIPIENT_WALLET_KEY)
    );

    assert.equal(response.status, 403);
    assert.equal(chainNetworkChecks, 0);
  });
});

describe("logging hygiene", () => {
  test("a synthetic credential never reaches a response or a log", async () => {
    reset();
    logRecords.length = 0;
    // A failure whose message carries a credential-shaped value, exactly as a provider,
    // Prisma or the RPC client can produce. It must not be echoed anywhere.
    dropLookupFailure = new Error(`connect failed: ${SENSITIVE_FIXTURE}`);
    const response = await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      RECIPIENT_TOKEN,
      await relayBody(RECIPIENT_WALLET, RECIPIENT_WALLET_KEY)
    );
    const body = await response.text();

    assert.ok(
      !body.includes(SENSITIVE_FIXTURE),
      `the response echoed a credential: ${body}`
    );
    assert.ok(
      !logRecords.join("\n").includes(SENSITIVE_FIXTURE),
      "a log record carried a credential"
    );
  });

  test("a thrown string is not echoed either", async () => {
    reset();
    logRecords.length = 0;
    dropLookupFailure = new Error(SENSITIVE_FIXTURE);

    await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      RECIPIENT_TOKEN,
      await relayBody(RECIPIENT_WALLET, RECIPIENT_WALLET_KEY)
    );

    assert.ok(!logRecords.join("\n").includes(SENSITIVE_FIXTURE));
  });

  test("a multiline failure message does not leak through the logged stack", async () => {
    reset();
    logRecords.length = 0;
    // Stacks are logged outside production, and V8 repeats a multiline message across the
    // leading lines of `stack` - so the leak is only visible with a multiline message.
    dropLookupFailure = new Error(
      `provider failure\n${SENSITIVE_FIXTURE}\nmore of the message`
    );

    await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      RECIPIENT_TOKEN,
      await relayBody(RECIPIENT_WALLET, RECIPIENT_WALLET_KEY)
    );

    const captured = logRecords.join("\n");
    assert.equal(
      captured.includes(SENSITIVE_FIXTURE),
      false,
      "a multiline message leaked into the captured logs"
    );

    // The failure is a foreign error, so it contributes no stack at all.
    for (const record of logRecords) {
      assert.equal(
        record.includes('"stack"'),
        false,
        `a stack was logged for a foreign error: ${record.slice(0, 160)}`
      );
    }
  });

  test("a message line shaped like a stack frame does not reach the logs", async () => {
    reset();
    logRecords.length = 0;
    // Filtering the concatenated stack cannot separate this from a genuine frame, which is
    // why provenance is not inferred by parsing at all.
    dropLookupFailure = new Error(
      `provider failure\n    at ${SENSITIVE_FIXTURE} (/provider.ts:1:1)`
    );

    await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      RECIPIENT_TOKEN,
      await relayBody(RECIPIENT_WALLET, RECIPIENT_WALLET_KEY)
    );

    assert.equal(
      logRecords.join("\n").includes(SENSITIVE_FIXTURE),
      false,
      "a frame-shaped message line reached the logs"
    );
  });

  test("our own errors still log frames", async () => {
    reset();
    logRecords.length = 0;

    // A recipient-policy refusal is an error this repository authored, so its frames are the
    // one stack a request still produces. Losing those would cost the diagnosis that made
    // omitting foreign stacks acceptable.
    await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      STRANGER_TOKEN,
      await relayBody(STRANGER_WALLET, STRANGER_WALLET_KEY)
    );

    const captured = logRecords.join("\n");
    assert.ok(
      captured.includes('"stack"'),
      "an authored error should still contribute frames"
    );
    assert.ok(captured.includes("at "), "frames should be present");
  });

  test("validation failures do not echo the rejected value", async () => {
    reset();
    logRecords.length = 0;

    // An enum violation is one of the Zod messages that names what it received.
    const response = await post(
      `/api/drops/${TEST_DROP_ID}/claim-permit`,
      RECIPIENT_TOKEN,
      {
        claimerAddress: RECIPIENT_WALLET,
        walletType: SENSITIVE_FIXTURE,
      }
    );
    const body = await response.text();

    assert.equal(response.status, 400);
    assert.ok(
      !body.includes(SENSITIVE_FIXTURE),
      `the response echoed the rejected value: ${body}`
    );
    assert.ok(!logRecords.join("\n").includes(SENSITIVE_FIXTURE));
  });

  test("nothing reaches the raw log stream either", async () => {
    reset();
    logRecords.length = 0;

    // The capture above replaces the exported logger's level methods, which cannot see a
    // record written through a library's own child logger or a bare console call. Watching the
    // process stream for the duration of one request closes that blind spot.
    const originalWrite = process.stdout.write.bind(process.stdout);
    const streamed: string[] = [];
    const patched = (
      chunk: unknown,
      ...rest: unknown[]
    ): boolean => {
      streamed.push(String(chunk));
      return (
        originalWrite as unknown as (
          c: unknown,
          ...r: unknown[]
        ) => boolean
      )(chunk, ...rest);
    };
    (process.stdout as unknown as { write: typeof patched }).write = patched;

    try {
      dropLookupFailure = new Error(`connect failed: ${SENSITIVE_FIXTURE}`);
      await post(
        `/api/drops/${TEST_DROP_ID}/relay-claim`,
        RECIPIENT_TOKEN,
        await relayBody(RECIPIENT_WALLET, RECIPIENT_WALLET_KEY)
      );
    } finally {
      (process.stdout as unknown as { write: unknown }).write = originalWrite;
    }

    // The request went through a logging path, so the absence below is meaningful.
    assert.ok(
      logRecords.length > 0,
      "the request logged nothing, so this proves nothing"
    );
    assert.equal(
      streamed.join("").includes(SENSITIVE_FIXTURE),
      false,
      "a credential reached the raw log stream"
    );
  });

  test("synthetic credentials and identifiers never reach the logger", async () => {
    reset();
    logRecords.length = 0;

    await post(
      `/api/drops/${TEST_DROP_ID}/relay-claim`,
      STRANGER_TOKEN,
      await relayBody(STRANGER_WALLET, STRANGER_WALLET_KEY)
    );
    await post(`/api/drops/${TEST_DROP_ID}/claim-permit`, RECIPIENT_TOKEN, {
      claimerAddress: RECIPIENT_WALLET,
      walletType: "privy",
    });
    await post(`/api/drops/${TEST_DROP_ID}/claimed`, RECIPIENT_TOKEN, {
      txHash: SETTLEMENT_TX_HASH,
      claimerAddress: RECIPIENT_WALLET,
      walletType: "privy",
    });

    assert.ok(logRecords.length > 0, "expected the exercised paths to log something");

    const captured = logRecords.join("\n");
    for (const secret of [
      SYNTHETIC_IDENTITY_TOKEN,
      RECIPIENT_EMAIL,
      STRANGER_EMAIL,
      STRANGER_PRIVY_ID,
      RECIPIENT_PRIVY_ID,
      SENSITIVE_FIXTURE,
    ]) {
      assert.ok(
        !captured.includes(secret),
        `log output contained a synthetic credential or identifier: ${secret}`
      );
    }
  });
});
