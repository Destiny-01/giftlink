import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { httpLogger } from "./middleware/logger";
import { errorHandler } from "./middleware/errorHandler";
import routes from "./routes";

/**
 * Builds the Express application without starting a listener.
 *
 * Extracted so tests can drive the real route/controller/service path. The authorization
 * checks under review live in that path, so exercising a helper instead would not prove
 * the endpoints enforce them.
 */
export function createApp(): Express {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(
    cors({
      // Uses the validated env rather than reading process.env beside it, so the
      // `credentials: true` combination cannot silently fall back to a wildcard origin.
      origin: env.FRONTEND_URL,
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

  return app;
}
