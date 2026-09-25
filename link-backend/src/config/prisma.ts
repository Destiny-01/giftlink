import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "./env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Query logging is off by default, including in development.
 *
 * Prisma's `query` log serialises every statement with its bound parameters, so
 * `findFirst({ where: { email } })` prints the raw address, handle or provider id. That
 * is an incidental channel for exactly the data D-008 keeps out of logs, so it now has to
 * be asked for explicitly with `PRISMA_QUERY_LOG=true`.
 */
const logLevels: Prisma.LogLevel[] = env.PRISMA_QUERY_LOG
  ? ["query", "warn", "error"]
  : ["error"];

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logLevels,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
