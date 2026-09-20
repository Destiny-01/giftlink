import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { httpLogger } from "./middleware/logger";
import { errorHandler } from "./middleware/errorHandler";
import routes from "./routes";
import { startJobs } from "./jobs";

const app = express();

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
  })
);

// Cookie parsing (must be before body parsing)
app.use(cookieParser());

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(httpLogger);

// API routes
app.use("/api", routes);

app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 GiftLink backend running on port ${env.PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);
});

startJobs();

// Global error handlers
process.on(
  "unhandledRejection",
  (reason: Error | unknown, promise: Promise<any>) => {
    logger.error({
      error: "Unhandled Promise Rejection",
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      promise: promise,
    });
  }
);

process.on("uncaughtException", (error: Error) => {
  logger.error({
    error: "Uncaught Exception",
    message: error.message,
    stack: error.stack,
  });

  server.close(() => {
    logger.info("Server closed due to uncaught exception");
    process.exit(1);
  });

  setTimeout(() => {
    logger.error("Forcing exit after uncaught exception");
    process.exit(1);
  }, 10000);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  logger.info("SIGINT signal received: closing HTTP server");
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
});
