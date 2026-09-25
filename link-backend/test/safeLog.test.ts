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

  test("a stack contributes frames, never any part of the message", () => {
    const single = safeStack(new Error(`failed with ${SENSITIVE_FIXTURE}`));
    assert.ok(single, "expected frames to survive");
    assert.equal(single.includes(SENSITIVE_FIXTURE), false);

    // V8 spreads a multiline message across the *leading* lines of `stack`, so dropping only
    // the first line leaves the rest of the message behind, formatted as though it were a
    // frame. That is what makes `slice(1)` insufficient.
    const multiline = safeStack(
      new Error(`provider failure\n${SENSITIVE_FIXTURE}\nand more of the message`)
    );

    assert.ok(multiline, "expected frames to survive");
    assert.equal(
      multiline.includes(SENSITIVE_FIXTURE),
      false,
      "a multiline message leaked through the stack"
    );

    for (const line of multiline.split("\n")) {
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
