import { env } from "./config/env";
import { logger } from "./config/logger";
import { createApp } from "./app";
import { startJobs } from "./jobs";
import { errorDiagnostics, stackTraceAllowed } from "./utils/safeLog";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 GiftLink backend running on port ${env.PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);
});

startJobs();

// Global error handlers. These log allowlisted fields only: serialising the rejection
// value or the promise itself is what leaked context into the log sink.
process.on("unhandledRejection", (reason: unknown) => {
  logger.error({
    operation: "process",
    outcome: "unhandled_rejection",
    ...errorDiagnostics(reason),
    stack: stackTraceAllowed() && reason instanceof Error ? reason.stack : undefined,
  });
});

process.on("uncaughtException", (error: Error) => {
  logger.error({
    operation: "process",
    outcome: "uncaught_exception",
    ...errorDiagnostics(error),
    stack: stackTraceAllowed() ? error.stack : undefined,
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
