import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SENSITIVE_FIXTURE } from "./setup";

import {
  contractRevertReason,
  errorDiagnostics,
  isMinedRevert,
  safeStack,
} from "../src/utils/safeLog";
const { ValidationError, ChainEvidenceError } = require("../src/utils/errors") as typeof import("../src/utils/errors");

describe("error diagnostics", () => {
  test("a foreign error's message is never carried into a log record", () => {
    // Providers, Prisma and the RPC client all compose messages from the values they were
    // handed, so a message is exactly where a token or an identifier turns up.
    const diagnostics = errorDiagnostics(
      new Error(`request failed for token ${SENSITIVE_FIXTURE}`)
    );

    assert.equal(JSON.stringify(diagnostics).includes(SENSITIVE_FIXTURE), false);
    assert.notEqual(diagnostics.error, SENSITIVE_FIXTURE);
    assert.equal(diagnostics.errorType, "Error");
  });

  test("a thrown string is not carried into a log record", () => {
    const diagnostics = errorDiagnostics(SENSITIVE_FIXTURE);
    assert.equal(JSON.stringify(diagnostics).includes(SENSITIVE_FIXTURE), false);
    assert.equal(diagnostics.errorType, "ThrownString");
  });

  test("machine codes are kept, because they are a fixed shape", () => {
    const coded = Object.assign(new Error("boom"), { code: "INSUFFICIENT_FUNDS" });
    assert.equal(errorDiagnostics(coded).errorCode, "INSUFFICIENT_FUNDS");

    // Anything that is not code-shaped is dropped rather than logged.
    const noisy = Object.assign(new Error("boom"), {
      code: `not a code ${SENSITIVE_FIXTURE}`,
    });
    assert.equal(errorDiagnostics(noisy).errorCode, undefined);
    assert.equal(
      JSON.stringify(errorDiagnostics(noisy)).includes(SENSITIVE_FIXTURE),
      false
    );
  });

  test("our own authored messages are kept", () => {
    const diagnostics = errorDiagnostics(
      new ValidationError("Drop is not confirmed on-chain yet")
    );
    assert.equal(diagnostics.error, "Drop is not confirmed on-chain yet");
    assert.equal(diagnostics.errorType, "ValidationError");
  });

  test("a foreign error contributes no stack at all", () => {
    // `Error.stack` concatenates the message with the frames, and no filter can tell the two
    // apart: a message line that is itself frame-shaped survives any pattern. Provenance is
    // therefore not inferred by parsing, so a foreign stack is omitted rather than filtered.
    assert.equal(safeStack(new Error(`failed with ${SENSITIVE_FIXTURE}`)), undefined);

    assert.equal(
      safeStack(new Error(`provider failure\n${SENSITIVE_FIXTURE}\nand more`)),
      undefined
    );

    // The shape a reviewer reproduced: a message continuation that looks exactly like a frame.
    assert.equal(
      safeStack(
        new Error(
          `provider failure\n    at synthetic-private-fixture (/provider.ts:1:1)`
        )
      ),
      undefined
    );

    assert.equal(safeStack(SENSITIVE_FIXTURE), undefined);
  });

  test("our own errors keep frames, without the leading line", () => {
    const stack = safeStack(
      new ValidationError("Drop is not confirmed on-chain yet")
    );

    assert.ok(stack, "expected frames to survive for an authored error");
    assert.equal(
      stack.includes("Drop is not confirmed"),
      false,
      "the message line should not survive"
    );

    for (const line of stack.split("\n")) {
      assert.match(
        line,
        /^\s*at\s/,
        `a non-frame line survived the stack: ${line}`
      );
    }
  });

  test("only revert strings from our own contract are recorded", () => {
    assert.equal(
      contractRevertReason(Object.assign(new Error("x"), { reason: "Drop not active" })),
      "Drop not active"
    );
    // A node or a different contract can produce any string at all.
    assert.equal(
      contractRevertReason(
        Object.assign(new Error("x"), { reason: SENSITIVE_FIXTURE })
      ),
      undefined
    );
  });

  test("a mined revert is named, because it carries no reason", () => {
    // `tx.wait()` reports a reverted transaction this way: the failed receipt is attached and
    // there is no `reason`, so a reason-only check would treat it as an unknown failure and
    // never try to recover the settlement that may already exist.
    const mined = Object.assign(new Error("transaction execution reverted"), {
      code: "CALL_EXCEPTION",
      receipt: { status: 0 },
    });

    assert.equal(contractRevertReason(mined), undefined);
    assert.equal(isMinedRevert(mined), true);
    // A successful receipt is not a revert, and neither is an unrelated failure.
    assert.equal(
      isMinedRevert(
        Object.assign(new Error("x"), {
          code: "CALL_EXCEPTION",
          receipt: { status: 1 },
        })
      ),
      false
    );
    assert.equal(isMinedRevert(new Error("network down")), false);
  });

  test("the error taxonomy is distinguishable by type", () => {
    // The claim paths need this: "your evidence is wrong" is a different answer from "our
    // deployment is misconfigured".
    assert.ok(new ChainEvidenceError("x") instanceof ChainEvidenceError);
    assert.ok(new ChainEvidenceError("x") instanceof Error);
  });
});
