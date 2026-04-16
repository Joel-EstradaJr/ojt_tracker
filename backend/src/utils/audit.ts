import { AuditAction, Prisma } from "@prisma/client";
import prisma from "./prisma";

export interface AuditLogInput {
  actionType: AuditAction;
  entityName: string;
  recordId: string;
  performedById?: string | null;
  oldValues?: Prisma.InputJsonValue | null;
  newValues?: Prisma.InputJsonValue | null;
  metadata?: Prisma.InputJsonValue | null;
}

export function createAuditLog(input: AuditLogInput) {
  return prisma.auditLog.create({
    data: {
      actionType: input.actionType,
      entityName: input.entityName,
      recordId: input.recordId,
      performedById: input.performedById ?? null,
      ...(input.oldValues !== undefined
        ? { oldValues: input.oldValues === null ? Prisma.DbNull : input.oldValues }
        : {}),
      ...(input.newValues !== undefined
        ? { newValues: input.newValues === null ? Prisma.DbNull : input.newValues }
        : {}),
      ...(input.metadata !== undefined
        ? { metadata: input.metadata === null ? Prisma.DbNull : input.metadata }
        : {}),
    },
  });
}
