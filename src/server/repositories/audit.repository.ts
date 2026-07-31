import type { AuditAction } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";

export async function addAuditLog(input: {
  userId?: string;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  oldValues?: unknown;
  newValues?: unknown;
  metadata?: unknown;
}) {
  return prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      oldValues: input.oldValues as never,
      newValues: input.newValues as never,
      metadata: input.metadata as never,
    },
  });
}

export async function listAuditLogs(input?: {
  userId?: string;
  action?: AuditAction;
  entityType?: string;
  limit?: number;
}) {
  return prisma.auditLog.findMany({
    where: {
      userId: input?.userId,
      action: input?.action,
      entityType: input?.entityType,
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          username: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: input?.limit ?? 200,
  });
}
