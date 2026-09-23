import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { TEST_CONTRACT_ADDRESS } from "./setup";

const {
  extractSettlement,
  extractCreation,
  extractRevocation,
} = require("../src/services/chainEvidence") as typeof import("../src/services/chainEvidence");
const { giftLinkInterface } = require("../src/config/abi") as typeof import("../src/config/abi");
const { ChainEvidenceError, ValidationError } = require("../src/utils/errors") as typeof import("../src/utils/errors");

const OTHER_CONTRACT = "0x4444444444444444444444444444444444444444";
const CLAIMER = "0xaaaa1111aaaa1111aaaa1111aaaa1111aaaa1111";
const RELAYER = "0xbbbb2222bbbb2222bbbb2222bbbb2222bbbb2222";
const GIFT_ID = 4242n;
const TX_HASH = "0x" + "ab".repeat(32);

function logFor(
  address: string,
  fragment: string,
  values: unknown[],
  index = 0
) {
  const encoded = giftLinkInterface.encodeEventLog(
    giftLinkInterface.getEvent(fragment)!,
    values
  );
  return {
    address,
    topics: [...encoded.topics],
    data: encoded.data,
    index,
    transactionHash: TX_HASH,
    blockNumber: 123,
    removed: false,
  };
}

function receiptWith(logs: unknown[], status = 1) {
  return {
    hash: TX_HASH,
    status,
    blockNumber: 123,
    logs,
  } as never;
}

describe("settlement evidence", () => {
  test("a matching DropClaimed event from the configured contract is accepted", () => {
    const receipt = receiptWith([
      logFor(TEST_CONTRACT_ADDRESS, "DropClaimed", [
        GIFT_ID,
        CLAIMER,
        RELAYER,
        1_000_000n,
        5_000_000n,
      ]),
    ]);

    const facts = extractSettlement(receipt, {
      contractAddress: TEST_CONTRACT_ADDRESS,
      onchainId: GIFT_ID,
    });

    assert.equal(facts.onchainId, GIFT_ID);
    assert.equal(facts.claimer, CLAIMER.toLowerCase());
    assert.equal(facts.relayer, RELAYER.toLowerCase());
    assert.equal(facts.amountToClaimer, 1_000_000n);
    assert.equal(facts.amountToRelayer, 5_000_000n);
    assert.equal(facts.txHash, TX_HASH);
  });

  test("a receipt that does not emit from the configured contract is refused", () => {
    const receipt = receiptWith([
      logFor(OTHER_CONTRACT, "DropClaimed", [
        GIFT_ID,
        CLAIMER,
        RELAYER,
        1_000_000n,
        5_000_000n,
      ]),
    ]);

    assert.throws(
      () =>
        extractSettlement(receipt, {
          contractAddress: TEST_CONTRACT_ADDRESS,
          onchainId: GIFT_ID,
        }),
      ChainEvidenceError
    );
  });

  test("a settlement of a different gift is refused", () => {
    const receipt = receiptWith([
      logFor(TEST_CONTRACT_ADDRESS, "DropClaimed", [
        9999n,
        CLAIMER,
        RELAYER,
        1_000_000n,
        5_000_000n,
      ]),
    ]);

    assert.throws(
      () =>
        extractSettlement(receipt, {
          contractAddress: TEST_CONTRACT_ADDRESS,
          onchainId: GIFT_ID,
        }),
      ChainEvidenceError
    );
  });

  test("a successful transaction with no settlement event cannot mark a gift claimed", () => {
    const receipt = receiptWith([
      logFor(TEST_CONTRACT_ADDRESS, "DropCreated", [
        GIFT_ID,
        CLAIMER,
        1_000_000n,
        5_000_000n,
        "0x" + "00".repeat(32),
        1,
        0n,
      ]),
    ]);

    assert.throws(
      () =>
        extractSettlement(receipt, {
          contractAddress: TEST_CONTRACT_ADDRESS,
          onchainId: GIFT_ID,
        }),
      ChainEvidenceError
    );
  });

  test("a failed or unconfirmed receipt is refused", () => {
    const receipt = receiptWith(
      [
        logFor(TEST_CONTRACT_ADDRESS, "DropClaimed", [
          GIFT_ID,
          CLAIMER,
          RELAYER,
          1_000_000n,
          5_000_000n,
        ]),
      ],
      0
    );

    assert.throws(
      () =>
        extractSettlement(receipt, {
          contractAddress: TEST_CONTRACT_ADDRESS,
          onchainId: GIFT_ID,
        }),
      ValidationError
    );
  });

  test("conflicting duplicate settlement events are refused", () => {
    const receipt = receiptWith([
      logFor(
        TEST_CONTRACT_ADDRESS,
        "DropClaimed",
        [GIFT_ID, CLAIMER, RELAYER, 1_000_000n, 5_000_000n],
        0
      ),
      logFor(
        TEST_CONTRACT_ADDRESS,
        "DropClaimed",
        [GIFT_ID, RELAYER, RELAYER, 9_000_000n, 5_000_000n],
        1
      ),
    ]);

    assert.throws(
      () =>
        extractSettlement(receipt, {
          contractAddress: TEST_CONTRACT_ADDRESS,
          onchainId: GIFT_ID,
        }),
      /conflicting DropClaimed events/
    );
  });

  test("a repeated identical settlement event converges instead of failing", () => {
    const duplicate = () =>
      logFor(TEST_CONTRACT_ADDRESS, "DropClaimed", [
        GIFT_ID,
        CLAIMER,
        RELAYER,
        1_000_000n,
        5_000_000n,
      ]);

    const receipt = receiptWith([duplicate(), duplicate()]);

    const facts = extractSettlement(receipt, {
      contractAddress: TEST_CONTRACT_ADDRESS,
      onchainId: GIFT_ID,
    });
    assert.equal(facts.claimer, CLAIMER.toLowerCase());
  });
});

describe("creation evidence", () => {
  const COMMIT = "0x" + "cd".repeat(32);

  test("a matching DropCreated event is decoded with the commitment the sender fixed", () => {
    const receipt = receiptWith([
      logFor(TEST_CONTRACT_ADDRESS, "DropCreated", [
        GIFT_ID,
        CLAIMER,
        1_000_000n,
        5_000_000n,
        COMMIT,
        1,
        1_800_000_000n,
      ]),
    ]);

    const facts = extractCreation(receipt, {
      contractAddress: TEST_CONTRACT_ADDRESS,
      onchainId: GIFT_ID,
    });

    assert.equal(facts.onchainId, GIFT_ID);
    assert.equal(facts.sender, CLAIMER.toLowerCase());
    assert.equal(facts.recipientCommit, COMMIT);
    assert.equal(facts.amount, 1_000_000n);
    assert.equal(facts.expiry, 1_800_000_000n);
  });

  test("a creation from another contract cannot confirm a gift", () => {
    const receipt = receiptWith([
      logFor(OTHER_CONTRACT, "DropCreated", [
        GIFT_ID,
        CLAIMER,
        1_000_000n,
        5_000_000n,
        COMMIT,
        1,
        0n,
      ]),
    ]);

    assert.throws(
      () =>
        extractCreation(receipt, {
          contractAddress: TEST_CONTRACT_ADDRESS,
          onchainId: GIFT_ID,
        }),
      ChainEvidenceError
    );
  });

  test("a creation of a different gift id is refused", () => {
    const receipt = receiptWith([
      logFor(TEST_CONTRACT_ADDRESS, "DropCreated", [
        777n,
        CLAIMER,
        1_000_000n,
        5_000_000n,
        COMMIT,
        1,
        0n,
      ]),
    ]);

    assert.throws(
      () =>
        extractCreation(receipt, {
          contractAddress: TEST_CONTRACT_ADDRESS,
          onchainId: GIFT_ID,
        }),
      ChainEvidenceError
    );
  });
});

describe("revocation evidence", () => {
  test("a matching DropRevoked event is decoded", () => {
    const receipt = receiptWith([
      logFor(TEST_CONTRACT_ADDRESS, "DropRevoked", [GIFT_ID, CLAIMER, 6_000_000n]),
    ]);

    const facts = extractRevocation(receipt, {
      contractAddress: TEST_CONTRACT_ADDRESS,
      onchainId: GIFT_ID,
    });

    assert.equal(facts.onchainId, GIFT_ID);
    assert.equal(facts.sender, CLAIMER.toLowerCase());
    assert.equal(facts.totalRefunded, 6_000_000n);
  });

  test("an unrelated successful transaction cannot revoke a gift", () => {
    const receipt = receiptWith([
      logFor(TEST_CONTRACT_ADDRESS, "DropClaimed", [
        GIFT_ID,
        CLAIMER,
        RELAYER,
        1_000_000n,
        5_000_000n,
      ]),
    ]);

    assert.throws(
      () =>
        extractRevocation(receipt, {
          contractAddress: TEST_CONTRACT_ADDRESS,
          onchainId: GIFT_ID,
        }),
      ChainEvidenceError
    );
  });
});
