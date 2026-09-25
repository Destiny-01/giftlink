import pinoHttp from "pino-http";
import { logger } from "../config/logger";
import { errorTypeName } from "../utils/safeLog";

export const httpLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => req.url === "/health",
  },
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      return "warn";
    } else if (res.statusCode >= 500 || err) {
      return "error";
    }
    return "info";
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} - ${res.statusCode}`;
  },
  customErrorMessage: (req, res, err) => {
    // The class name only: a foreign error's message can carry the values it was given.
    return `${req.method} ${req.url} - ${res.statusCode} - ${errorTypeName(err)}`;
  },
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      path: req.path,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
});
