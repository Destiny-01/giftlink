/**
 * Allowlisted diagnostic fields for logs.
 *
 * D-008 keeps raw identifiers, credentials and private eligibility data out of public
 * logs, and the audit found whole-object dumps reaching the log sink
 * (`docs/foundation-audit.md` §2.11). Log records should therefore carry a small, named
 * set of fields - operation, outcome, a safe correlation id such as a gift id, and a
 * transaction hash - rather than serialised requests, transaction objects, user records
 * or errors.
 */

export interface ErrorDiagnostics {
  /** Message only. Never the error object, which is what dragged context into logs. */
  error: string;
  errorType: string;
}

/**
 * Reduces any thrown value to a type and a message.
 *
 * The message is kept because it is what a human needs to diagnose a failure; the object
 * is not, because serialising it is what leaked request context, transaction payloads and
 * user records into the log sink.
 */
export function errorDiagnostics(error: unknown): ErrorDiagnostics {
  if (error instanceof Error) {
    return {
      error: error.message,
      errorType: error.name || "Error",
    };
  }

  if (typeof error === "string") {
    return { error, errorType: "Error" };
  }

  return { error: "Non-error value thrown", errorType: "UnknownError" };
}

/**
 * Stack traces are useful while developing and are kept out of production logs, where
 * they can carry values that a caller or a library interpolated into a message.
 */
export function stackTraceAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}
