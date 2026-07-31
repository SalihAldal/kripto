import { persistAuditLog } from "@/src/server/aoc/aoc.repository";
import { emitAocEvent, AOC_EVENT } from "@/src/server/aoc/aoc.events";

export async function logAuditAction(actionType: string, target: string, success: boolean, details?: Record<string, unknown>, actor = "AOC") {
  const record = await persistAuditLog(actionType, target, success, details, actor);
  emitAocEvent(AOC_EVENT.AUDIT_LOGGED, { auditKey: record.auditKey, actionType });
  return record;
}

export async function listRecentAudit(limit = 100) {
  const { prisma } = await import("@/src/server/db/prisma");
  return prisma.aocAuditLog.findMany({ orderBy: { recordedAt: "desc" }, take: limit });
}
