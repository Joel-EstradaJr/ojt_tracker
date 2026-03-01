// ============================================================
// Prisma Client Singleton
// Re-use one PrismaClient instance across the entire backend
// to avoid exhausting database connections during development.
// ============================================================

import { PrismaClient } from "@prisma/client";

// Extend the global object so we can cache the client in dev
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const prisma: PrismaClient = global.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

export default prisma;
