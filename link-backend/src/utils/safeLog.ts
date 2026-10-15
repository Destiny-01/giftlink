import { AppError } from "./errors";

/**
 * Allowlisted diagnostic fields for logs.
 *
 * D-008 keeps raw identifiers, credentials and private eligibility data out of public
 * logs, and whole-object dumps used to reach the log sink. Log records therefore carry a small, named set of
 * fields - operation, outcome, a safe correlation id such as a gift id, and a
 * transaction hash - rather than serialised requests, transaction objects, user records
 * or errors.
 *
 * Nothing composed by a library or a caller is ever logged verbatim. A provider message
 * can embed the request body, a bearer token, an identifier or transaction calldata, so
 * copying `error.message` into a log record moves private data *into* the sink rather
 * than out of it. Only messages this repository authors (`AppError` and its subclasses,
 * which are also what the client receives) plus machine-readable codes from a fixed shape
 * are recorded.
 */

export interface ErrorDiagnostics {
  /**
   * A controlled label, or an `AppError` message authored in this repository. Never a
   * third-party message, and never a value a caller supplied.
   */
  error: string;
  /** The error's class name, when it looks like one. */
  errorType: string;
  /** A machine-readable classifier such as an ethers or Prisma code, when present. */
  errorCode?: string;
}

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;
const UNCLASSIFIED = "Unclassified failure";

function safeName(value: unknown, fallback: string): string {
  return typeof value === "string" && NAME_PATTERN.test(value) ? value : fallback;
}

function safeCode(error: unknown): string | undefined {
  const candidate = (error as { code?: unknown } | null)?.code;
  if (typeof candidate === "string" && CODE_PATTERN.test(candidate)) {
    return candidate;
  }
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return `CODE_${candidate}`;
  }
  return undefined;
}

/**
 * Reduces any thrown value to a type, a controlled label and an optional machine code.
 *
 * Deliberately never returns `error.message` for a foreign error. Providers, the RPC
 * client and Prisma all compose messages from the values they were given, so a message is
 * exactly where a token, an email address or a block of calldata ends up.
 */
export function errorDiagnostics(error: unknown): ErrorDiagnostics {
  if (error instanceof AppError) {
    // Authored here, and already the text the client is shown.
    return {
      error: error.message,
      errorType: safeName(error.name, "AppError"),
    };
  }

  const errorType = safeName(
    error instanceof Error ? error.name : undefined,
    typeof error === "string" ? "ThrownString" : "UnknownError"
  );
  const errorCode = safeCode(error);

  return errorCode
    ? { error: UNCLASSIFIED, errorType, errorCode }
    : { error: UNCLASSIFIED, errorType };
}

/** The error's class name, when it looks like one. Safe as a diagnostic field. */
export function errorTypeName(error: unknown): string {
  return safeName(error instanceof Error ? error.name : undefined, "Error");
}

/**
 * V8's frame lines: `at fn (path:line:col)` (`at async fn (...)`, `at eval (eval at a.ts:1:1,
 * <anon>:2:3)`) or a bare `at path:line:col`. Used only to strip the leading line from an
 * error this repository authored; it is not a provenance check.
 */
const STACK_FRAME_PATTERN = /^\s*at\s(?:.+\(.*:\d+:\d+\)|\S+:\d+:\d+)$/;

/**
 * A stack for errors this repository authored, and nothing for anyone else's.
 *
 * `Error.stack` is a single string: V8 formats it as `Name: message` followed by the frames,
 * so a multiline message occupies leading lines that sit in the same string as the frames.
 * **No filter over that string can tell a message line from a frame** - a message line that
 * happens to be frame-shaped survives any pattern, which is why an earlier attempt at this
 * was wrong and why the residue cannot be documented away. Provenance is not recoverable by
 * parsing, so it is not attempted:
 *
 * - an `AppError` message is authored here and already returned to the client, so its stack
 *   adds nothing that is not already logged, and the leading line is stripped anyway;
 * - a foreign error contributes **no stack at all**. Its frames are lost, which is a real
 *   cost to diagnosis and is recorded as a residual risk in the pull request; the caller
 *   still gets the operation, the outcome, the error class and any machine code.
 */
export function safeStack(error: unknown): string | undefined {
  if (!(error instanceof AppError) || typeof error.stack !== "string") {
    return undefined;
  }

  const frames = error.stack
    .split("\n")
    .filter((line) => STACK_FRAME_PATTERN.test(line));

  return frames.length > 0 ? frames.join("\n") : undefined;
}

/** The prefix ethers attaches to a reason it extracted from a revert. */
const REVERT_PREFIX = /^execution reverted:?\s*/i;

/**
 * The revert strings `contracts/GiftLink.sol` itself can produce.
 *
 * A revert reason is the one piece of free text from a chain call worth recording, and it
 * is only trustworthy when it is one of ours: anything else came from the node or from a
 * different contract, so it is dropped rather than logged.
 */
const CONTRACT_REVERT_REASONS = new Set([
  "Invalid USDC address",
  "Invalid backend signer",
  "Drop not active",
  "Only sender",
  "Amount must be > 0",
  "Invalid recipient type",
  "ID collision",
  "Invalid claimer",
  "Drop expired",
  "Permit expired",
  "Invalid permit signature",
  "Not a public drop",
  "Not expired yet",
  "Invalid signer",
]);

export function contractRevertReason(error: unknown): string | undefined {
  const candidate = error as {
    reason?: unknown;
    shortMessage?: unknown;
  } | null;

  for (const value of [candidate?.reason, candidate?.shortMessage]) {
    if (typeof value !== "string") {
      continue;
    }

    // ethers often reports the revert with its own prefix attached. Only the prefix is
    // stripped: the remainder still has to be one of our strings exactly, so a node cannot
    // get arbitrary text recorded by wrapping it.
    const stripped = value.replace(REVERT_PREFIX, "").trim();
    if (CONTRACT_REVERT_REASONS.has(stripped)) {
      return stripped;
    }
  }

  return undefined;
}

/** Provider/gas failures we can name without echoing anything they composed. */
export function isInsufficientFundsError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "INSUFFICIENT_FUNDS";
}

/**
 * A transaction that was mined and reverted.
 *
 * ethers reports this shape with no reason at all: a `CALL_EXCEPTION` carrying the failed
 * receipt. It is worth naming separately because it can mean an earlier attempt already
 * settled the gift, which a caller should reconcile rather than report as a failure -
 * `contractRevertReason` alone misses it, since a reason is only present when the revert
 * was caught while estimating.
 */
export function isMinedRevert(error: unknown): boolean {
  const candidate = error as {
    code?: unknown;
    receipt?: { status?: unknown };
  } | null;

  return candidate?.code === "CALL_EXCEPTION" && candidate?.receipt?.status === 0;
}

/**
 * Stack traces are useful while developing and are kept out of production logs, where
 * they can carry values that a caller or a library interpolated into a message.
 */
export function stackTraceAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}
