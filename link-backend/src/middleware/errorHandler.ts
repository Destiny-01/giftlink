import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors";
import { logger } from "../config/logger";

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    logger.error({
      error: err.message,
      errorType: err.name,
      statusCode: err.statusCode,
      path: req.path,
      method: req.method,
      stack: err.stack,
    });
    return res.status(err.statusCode).json({
      error: {
        message: err.message,
        statusCode: err.statusCode,
      },
    });
  }

  logger.error({
    error: err.message,
    errorType: err.name || "Error",
    path: req.path,
    method: req.method,
    stack: err.stack,
  });
  return res.status(500).json({
    error: {
      message: "Internal server error",
      statusCode: 500,
    },
  });
}
