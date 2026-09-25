import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SENSITIVE_FIXTURE } from "./setup";

const {
  contractRevertReason,
  errorDiagnostics,
  safeStack,
} = require("../src/utils/safeLog") as typeof import("../src/utils/safeLog");
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

  test("a stack contributes frames, never the message line", () => {
    const stack = safeStack(new Error(`failed with ${SENSITIVE_FIXTURE}`));
    assert.ok(stack, "expected frames to survive");
    assert.equal(stack.includes(SENSITIVE_FIXTURE), false);
    assert.match(stack, /at /);
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

  test("the error taxonomy is distinguishable by type", () => {
    // The claim paths need this: "your evidence is wrong" is a different answer from "our
    // deployment is misconfigured".
    assert.ok(new ChainEvidenceError("x") instanceof ChainEvidenceError);
    assert.ok(new ChainEvidenceError("x") instanceof Error);
  });
});
