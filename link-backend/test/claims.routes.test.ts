import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import {
  RECIPIENT_EMAIL,
  RECIPIENT_SECOND_WALLET,
  RECIPIENT_WALLET,
  RECIPIENT_WALLET_KEY,
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
prisma.drop.findUnique = async () => currentDrop;
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
 * The RPC endpoint is the second seam. Stubbing the provider's own methods means the real
 * ABI decoding, event matching and authorization code all still run.
 */
const arcModule = require("../src/config/arcClient") as typeof import("../src/config/arcClient");
const provider = arcModule.getRpcProvider() as unknown as Record<string, any>;
const signerAddress = (require("../src/config/wallets") as typeof import("../src/config/wallets")).backendSigner.address;

provider.getNetwork = async () => {
  chainNetworkChecks += 1;
  return { chainId: BigInt(TEST_CHAIN_ID), name: "test" };
};
// A zero relayer balance stops the relay flow at the last gate before sending.
provider.getBalance = async () => 0n;
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
    return giftLinkInterface.encodeFunctionResult("USDC", [TEST_USDC_ADDRESS]);
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

const reset = () => {
  currentDrop = recipientDrop();
  settlementBehaviour = "valid";
  creationBehaviour = "valid";
  giftStatus = 0;
  settlementWrites.length = 0;
  dropUpdates.length = 0;
  chainNetworkChecks = 0;
};

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
});

describe("logging hygiene", () => {
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
    ]) {
      assert.ok(
        !captured.includes(secret),
        `log output contained a synthetic credential or identifier: ${secret}`
      );
    }
  });
});
