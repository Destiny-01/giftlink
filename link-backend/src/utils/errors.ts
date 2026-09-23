export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational = true
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
  constructor(message: string) {
    super(400, message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Resource not found") {
    super(404, message);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(401, message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Forbidden") {
    super(403, message);
    this.name = "ForbiddenError";
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = "Service Unavailable") {
    super(503, message);
    this.name = "ServiceUnavailableError";
  }
}

/**
 * Caller-supplied evidence does not prove what it claims on-chain (for example a
 * transaction hash that does not contain this gift's settlement event).
 */
export class ChainEvidenceError extends AppError {
  constructor(message: string) {
    super(409, message);
    this.name = "ChainEvidenceError";
  }
}

/**
 * The deployment and this service disagree about who or what they are talking to, or the
 * database and the chain disagree about a gift. This is an operator-facing diagnostic,
 * and the caller is refused rather than served from contradictory data.
 */
export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(503, message);
    this.name = "ConfigurationError";
  }
}
