import pino from "pino";
import { Writable } from "stream";

// Create a custom writable stream that formats pino's JSON output
const formatStream = new Writable({
  write(chunk, _encoding, callback) {
    const chunkStr = chunk.toString().trim();
    if (!chunkStr) {
      callback();
      return;
    }

    try {
      const log = JSON.parse(chunkStr);
      const timestamp = log.time ? new Date(log.time) : new Date();
      const time = timestamp.toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      
      let message = log.msg || log.message || "";
      
      // For errors, include error details and location
      if (log.error) {
        const errorType = log.errorType || "Error";
        message = `${errorType}: ${log.error}`;
        if (log.path && log.method) {
          message += ` at ${log.method} ${log.path}`;
        }
        if (log.statusCode) {
          message += ` (${log.statusCode})`;
        }
        if (log.stack && process.env.SHOW_STACK_TRACE === "true") {
          message += `\n${log.stack}`;
        }
      }
      
      // If message is already formatted by pino-http (contains method/url), use it as-is
      // Otherwise, format HTTP requests manually
      if (!message && log.method && log.url) {
        message = `${log.method} ${log.url}`;
        if (log.statusCode) {
          message += ` - ${log.statusCode}`;
        }
      }
      
      // Only output if we have a message
      if (message) {
        process.stdout.write(`[${time}] ${message}\n`);
      }
    } catch (error) {
      // If parsing fails, just output the raw chunk
      process.stdout.write(chunk);
    }
    callback();
  },
});

export const logger =
  process.env.NODE_ENV === "development"
    ? pino(
        {
          level: process.env.LOG_LEVEL || "info",
        },
        formatStream
      )
    : pino({
        level: process.env.LOG_LEVEL || "info",
      });
