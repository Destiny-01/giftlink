export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational = true,
    /**
     * A stable, machine-readable classifier for the client (for example
     * `issuer_not_allowlisted`). Optional; when present it is echoed in the JSON error body
     * so a UI can branch on it without parsing the message.
     */
    public code?: string
  ) {
    super(message);
    // `new.target` keeps the subclass prototype. Resetting to `AppError.prototype` here
    // would make every subclass fail its own `instanceof` check, which is exactly what the
    // claim paths need in order to distinguish "your evidence is wrong" from "our
    // deployment is misconfigured".
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, code?: string) {
    super(400, message, true, code);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Resource not found", code?: string) {
    super(404, message, true, code);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized", code?: string) {
    super(401, message, true, code);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Forbidden", code?: string) {
    super(403, message, true, code);
    this.name = "ForbiddenError";
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = "Service Unavailable", code?: string) {
    super(503, message, true, code);
    this.name = "ServiceUnavailableError";
  }
}

/**
 * Caller-supplied evidence does not prove what it claims on-chain (for example a
 * transaction hash that does not contain this gift's settlement event).
 */
export class ChainEvidenceError extends AppError {
  constructor(message: string, code?: string) {
    super(409, message, true, code);
    this.name = "ChainEvidenceError";
  }
}

/**
 * The deployment and this service disagree about who or what they are talking to, or the
 * database and the chain disagree about a gift. This is an operator-facing diagnostic,
 * and the caller is refused rather than served from contradictory data.
 */
export class ConfigurationError extends AppError {
  constructor(message: string, code?: string) {
    super(503, message, true, code);
    this.name = "ConfigurationError";
  }
}
