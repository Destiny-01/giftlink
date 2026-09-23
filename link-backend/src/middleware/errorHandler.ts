import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors";
import { logger } from "../config/logger";
import { errorDiagnostics, stackTraceAllowed } from "../utils/safeLog";

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const diagnostics = errorDiagnostics(err);
  const stack = stackTraceAllowed() ? err.stack : undefined;

  if (err instanceof AppError) {
    logger.error({
      operation: "http_request",
      outcome: "error",
      method: req.method,
      path: req.path,
      statusCode: err.statusCode,
      ...diagnostics,
      stack,
    });
    return res.status(err.statusCode).json({
      error: {
        message: err.message,
        statusCode: err.statusCode,
      },
    });
  }

  logger.error({
    operation: "http_request",
    outcome: "unhandled_error",
    method: req.method,
    path: req.path,
    statusCode: 500,
    ...diagnostics,
    stack,
  });
  return res.status(500).json({
    error: {
      message: "Internal server error",
      statusCode: 500,
    },
  });
}
