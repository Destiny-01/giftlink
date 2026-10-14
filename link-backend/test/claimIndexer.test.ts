import "./setup";
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { TEST_CHAIN_ID, TEST_CLAIM_CORE_ADDRESS } from "./setup";
import { entitlementRoot, generateEntitlementId } from "../src/utils/claimCore";
import { nomineClaimCoreInterface } from "../src/config/claimCoreAbi";
import { env } from "../src/config/env";

const {
  scanClaimEvents,
  replayClaimEvents,
} = require("../src/services/claimIndexer") as typeof import("../src/services/claimIndexer");
const { runClaimIndexerPass } =
  require("../src/jobs/claimIndexerJob") as typeof import("../src/jobs/claimIndexerJob");

/**
 * Synthetic on-chain fixtures. None of these addresses, hashes or identifiers is real; the
 * "deployment block" the scan floors at is the Arc testnet value the environment ships.
 */
const ISSUER = "0x" + "aa".repeat(20);
const ISSUER_APPROVER = "0x" + "bb".repeat(20);
const RESOLVER = "0x" + "cc".repeat(20);
const TX_HASH = "0x" + "dd".repeat(32);
const CONTRACT_ADDRESS = TEST_CLAIM_CORE_ADDRESS.toLowerCase();

// ---- Capture the logger so a skip or a refusal can be asserted without printing ----
interface LogRecord {
  level: string;
  payload: string;
}
const logRecords: LogRecord[] = [];
const loggerModule = require("../src/config/logger") as typeof import("../src/config/logger");
for (const level of ["info", "warn", "error", "debug", "fatal", "trace"] as const) {
  (loggerModule.logger as unknown as Record<string, unknown>)[level] = (
    ...args: unknown[]
  ) => {
    logRecords.push({ level, payload: JSON.stringify(args) });
  };
}

// ---- Mutable state the prisma/provider stubs read from ----
interface Candidate {
  id: string;
  issuerAddress: string;
  issuerPrivyId: string;
  entitlements: { entitlementId: string }[];
}

let checkpoint: { lastScannedBlock: bigint } | null = null;
let checkpointUpserts: number[] = [];
let latestBlock = 0;
let logsToReturn: unknown[] = [];
let getLogsFailure: (call: { fromBlock: number; toBlock: number }) => Error | null = () =>
  null;
const getLogsCalls: { address: string; fromBlock: number; toBlock: number }[] = [];
const storedEvents: unknown[] = [];
let replayEvents: unknown[] = [];
let candidates: Candidate[] = [];
let owner: { walletAddress: string | null } | null = null;
const campaignUpdates: { where: Record<string, unknown> }[] = [];

/**
 * The RPC endpoint is stubbed at its own methods, so the real range arithmetic, adaptive
 * shrinking and event decoding all still run. `getBlock` backs the block-timestamp read.
 */
const provider = {
  getBlockNumber: async () => latestBlock,
  getBlock: async () => ({ timestamp: 1_700_000_000 }),
  getLogs: async (filter: { address: string; fromBlock: number; toBlock: number }) => {
    getLogsCalls.push({
      address: filter.address,
      fromBlock: filter.fromBlock,
      toBlock: filter.toBlock,
    });
    const failure = getLogsFailure(filter);
    if (failure) {
      throw failure;
    }
    return logsToReturn;
  },
};

function scan(options: { fromBlock?: number; toBlock?: number } = {}) {
  return scanClaimEvents({ provider: provider as never, ...options });
}

function encodeLog(
  fragment: string,
  values: unknown[],
  blockNumber: number,
  index: number
) {
  const encoded = nomineClaimCoreInterface.encodeEventLog(
    nomineClaimCoreInterface.getEvent(fragment)!,
    values
  );
  return {
    address: CONTRACT_ADDRESS,
    topics: [...encoded.topics],
    data: encoded.data,
    index,
    transactionHash: TX_HASH,
    blockNumber,
    removed: false,
  };
}

function draft(id: string, entitlementIds: string[]): Candidate {
  return {
    id,
    issuerAddress: ISSUER,
    issuerPrivyId: "did:privy:issuer",
    entitlements: entitlementIds.map((entitlementId) => ({ entitlementId })),
  };
}

function fundedEvent(metadataRoot: string, funder: string) {
  return {
    id: "event-1",
    chainId: TEST_CHAIN_ID,
    contractAddress: CONTRACT_ADDRESS,
    eventType: "CAMPAIGN_FUNDED",
    campaignId: null,
    onchainCampaignId: 42n,
    entitlementId: null,
    walletAddress: funder.toLowerCase(),
    amount: "2000",
    txHash: TX_HASH,
    logIndex: 0,
    blockNumber: 100n,
    blockTimestamp: new Date(0),
    metadata: {
      issuerApprover: ISSUER_APPROVER.toLowerCase(),
      resolver: RESOLVER.toLowerCase(),
      allocation: "1000",
      entitlementCount: 2,
      entitlementRoot: metadataRoot,
    },
  };
}

// ---- Prisma seam: the service reads these off the shared client ----
const prismaModule = require("../src/config/prisma") as typeof import("../src/config/prisma");
const prisma = prismaModule.prisma as unknown as Record<string, any>;

prisma.chainCheckpoint = {
  findUnique: async () => checkpoint,
  upsert: async (args: {
    update?: { lastScannedBlock: bigint };
    create: { lastScannedBlock: bigint };
  }) => {
    const block = Number(
      args.update?.lastScannedBlock ?? args.create.lastScannedBlock
    );
    checkpointUpserts.push(block);
    checkpoint = { lastScannedBlock: BigInt(block) };
    return { lastScannedBlock: BigInt(block) };
  },
};

prisma.claimEvent = {
  findUnique: async () => null,
  create: async (args: unknown) => {
    storedEvents.push(args);
    return {};
  },
  findMany: async () => replayEvents,
};

prisma.campaign = {
  findFirst: async () => null,
  findMany: async () => candidates,
  updateMany: async (args: { where: Record<string, unknown> }) => {
    campaignUpdates.push(args);
    return { count: 1 };
  },
};

prisma.user = {
  findUnique: async () => owner,
};

beforeEach(() => {
  checkpoint = null;
  checkpointUpserts = [];
  latestBlock = 0;
  logsToReturn = [];
  getLogsFailure = () => null;
  getLogsCalls.length = 0;
  storedEvents.length = 0;
  replayEvents = [];
  candidates = [];
  owner = null;
  campaignUpdates.length = 0;
  logRecords.length = 0;
  env.INDEXER_MAX_BLOCK_RANGE = 10000;
});

describe("windowed adaptive scanning", () => {
  test("with no checkpoint the scan starts at the deploy block, never block 0", async () => {
    assert.ok(env.CLAIM_CORE_DEPLOY_BLOCK > 0, "the fixture deploy block is not 0");
    latestBlock = env.CLAIM_CORE_DEPLOY_BLOCK + 50;

    await scan();

    assert.equal(getLogsCalls[0].fromBlock, env.CLAIM_CORE_DEPLOY_BLOCK);
    assert.notEqual(getLogsCalls[0].fromBlock, 0);
  });

  test("a 2,500-block range is queried in consecutive windows, checkpointing after each", async () => {
    env.INDEXER_MAX_BLOCK_RANGE = 1000;
    const start = 5_000_000;

    await scan({ fromBlock: start, toBlock: start + 2499 });

    assert.deepEqual(
      getLogsCalls.map((call) => [call.fromBlock, call.toBlock]),
      [
        [start, start + 999],
        [start + 1000, start + 1999],
        [start + 2000, start + 2499],
      ]
    );
    assert.deepEqual(checkpointUpserts, [
      start + 999,
      start + 1999,
      start + 2499,
    ]);
  });

  test("a range rejection on a 1000-block window retries as 500, covering the range with no gap", async () => {
    env.INDEXER_MAX_BLOCK_RANGE = 1000;
    const start = 7_000_000;
    let rejected = false;
    getLogsFailure = (call) => {
      if (!rejected && call.toBlock - call.fromBlock + 1 > 500) {
        rejected = true;
        return Object.assign(
          new Error("query returned more than 10000 results"),
          { code: -32005 }
        );
      }
      return null;
    };

    await scan({ fromBlock: start, toBlock: start + 999 });

    assert.deepEqual(
      getLogsCalls.map((call) => [call.fromBlock, call.toBlock]),
      [
        [start, start + 999],
        [start, start + 499],
        [start + 500, start + 999],
      ]
    );
    // The two successful windows are contiguous: the covered range is exactly [start, start+999].
    assert.deepEqual(checkpointUpserts, [start + 499, start + 999]);
  });

  test("a range rejection wrapped the way ethers reports it still shrinks the window", async () => {
    env.INDEXER_MAX_BLOCK_RANGE = 1000;
    const start = 8_000_000;
    let rejected = false;
    getLogsFailure = (call) => {
      if (!rejected && call.toBlock - call.fromBlock + 1 > 500) {
        rejected = true;
        // Ethers never surfaces the raw code as `error.code`: that is its own string code, and
        // the server's numeric code and text are attached nested. The text here carries none of
        // the classifier's keywords, so detection can only come from the nested code.
        return Object.assign(new Error("could not coalesce error"), {
          code: "UNKNOWN_ERROR",
          error: { code: -32005, message: "query returned more than 10000 results" },
        });
      }
      return null;
    };

    await scan({ fromBlock: start, toBlock: start + 999 });

    assert.deepEqual(checkpointUpserts, [start + 499, start + 999]);
  });

  test("a non-range error in a later window keeps the checkpoint and propagates", async () => {
    env.INDEXER_MAX_BLOCK_RANGE = 1000;
    const start = 9_000_000;
    getLogsFailure = (call) =>
      call.fromBlock === start + 1000 ? new Error("connection reset") : null;

    await assert.rejects(
      () => scan({ fromBlock: start, toBlock: start + 1999 }),
      /connection reset/
    );

    // Only the first window completed, so only it is durably recorded.
    assert.deepEqual(checkpointUpserts, [start + 999]);
  });

  test("a window stores its decodable events, ignores unknown logs and checkpoints", async () => {
    env.INDEXER_MAX_BLOCK_RANGE = 1000;
    const start = 10_000_000;
    const ids = [generateEntitlementId(), generateEntitlementId()];
    logsToReturn = [
      encodeLog(
        "CampaignFunded",
        [
          42n,
          ISSUER,
          ISSUER_APPROVER,
          RESOLVER,
          1000n,
          2,
          2000n,
          0n,
          0n,
          entitlementRoot(ids),
        ],
        start + 1,
        0
      ),
      encodeLog("EIP712DomainChanged", [], start + 2, 1),
    ];

    const result = await scan({ fromBlock: start, toBlock: start + 5 });

    assert.equal(result.stored, 1);
    assert.equal(storedEvents.length, 1);
    assert.deepEqual(checkpointUpserts, [start + 5]);
  });
});

describe("draft binding by entitlement root", () => {
  test("two drafts with identical scalar config bind by root, not by count", async () => {
    const idsA = [generateEntitlementId(), generateEntitlementId()];
    const idsB = [generateEntitlementId(), generateEntitlementId()];
    assert.notEqual(entitlementRoot(idsA), entitlementRoot(idsB));

    candidates = [draft("campaign-a", idsA), draft("campaign-b", idsB)];
    owner = { walletAddress: ISSUER.toLowerCase() };
    replayEvents = [fundedEvent(entitlementRoot(idsA), ISSUER)];

    const result = await replayClaimEvents();

    assert.equal(result.funded, 1);
    assert.equal(campaignUpdates.length, 1);
    assert.equal(campaignUpdates[0].where.id, "campaign-a");
  });

  test("no root match leaves the funding event unbound", async () => {
    const ids = [generateEntitlementId(), generateEntitlementId()];
    candidates = [draft("campaign-a", ids)];
    owner = { walletAddress: ISSUER.toLowerCase() };
    // A committed root that names no returned draft's roster.
    replayEvents = [fundedEvent("0x" + "ab".repeat(32), ISSUER)];

    const result = await replayClaimEvents();

    assert.equal(result.funded, 0);
    assert.equal(campaignUpdates.length, 0);
  });

  test("a root match whose funder is neither the prepare-time wallet nor the owner is refused", async () => {
    const ids = [generateEntitlementId(), generateEntitlementId()];
    const stranger = "0x" + "77".repeat(20);
    candidates = [draft("campaign-a", ids)];
    owner = { walletAddress: "0x" + "88".repeat(20) };
    replayEvents = [fundedEvent(entitlementRoot(ids), stranger)];

    const result = await replayClaimEvents();

    assert.equal(result.funded, 0);
    assert.equal(campaignUpdates.length, 0);
    assert.ok(
      logRecords.some((record) => record.payload.includes("funder_mismatch")),
      "a funder mismatch should be logged"
    );
  });
});

describe("claim indexer job", () => {
  test("an overlapping cron tick is skipped while a pass is in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let secondRan = false;

    const first = runClaimIndexerPass(() => gate);
    const second = await runClaimIndexerPass(async () => {
      secondRan = true;
    });

    assert.equal(second, false);
    assert.equal(secondRan, false, "the overlapping pass ran");
    assert.ok(
      logRecords.some(
        (record) =>
          record.level === "debug" &&
          record.payload.includes("already in flight")
      ),
      "an overlapping tick should be logged at debug"
    );

    release();
    assert.equal(await first, true);
  });
});
