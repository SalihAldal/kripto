import { createHash } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma, ExecutionLogStatus, ExecutionReconciliationStatus } from "@prisma/client";

function key(prefix: string) {
  return `${prefix}_${createHash("sha256").update(`${prefix}_${Date.now()}_${Math.random()}`).digest("hex").slice(0, 16)}`;
}

export async function persistExecutionLog(input: {
  executionId: string;
  userId?: string;
  symbol: string;
  side: string;
  orderType: string;
  mode: string;
  quantity: number;
  quoteSpend?: number;
  requestedPrice?: number;
  averageFillPrice?: number;
  filledQuantity?: number;
  fee?: number;
  slippagePct?: number;
  status?: ExecutionLogStatus;
  latencyMs?: number;
  idempotencyKey?: string;
  entryAnalysisId?: string;
  exitAnalysisId?: string;
  riskApproved?: boolean;
  metadata?: Record<string, unknown>;
}) {
  return prisma.executionLog.create({
    data: {
      logKey: key("exlog"),
      executionId: input.executionId,
      userId: input.userId,
      symbol: input.symbol.toUpperCase(),
      side: input.side,
      orderType: input.orderType,
      mode: input.mode,
      quantity: input.quantity,
      quoteSpend: input.quoteSpend,
      requestedPrice: input.requestedPrice,
      averageFillPrice: input.averageFillPrice,
      filledQuantity: input.filledQuantity,
      fee: input.fee,
      slippagePct: input.slippagePct,
      status: input.status ?? "PENDING",
      latencyMs: input.latencyMs,
      idempotencyKey: input.idempotencyKey,
      entryAnalysisId: input.entryAnalysisId,
      exitAnalysisId: input.exitAnalysisId,
      riskApproved: input.riskApproved ?? false,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function updateExecutionLogVerified(logKey: string, input: Partial<{
  status: ExecutionLogStatus;
  averageFillPrice: number;
  filledQuantity: number;
  fee: number;
  slippagePct: number;
  metadata: Record<string, unknown>;
}>) {
  return prisma.executionLog.update({
    where: { logKey },
    data: {
      ...input,
      status: input.status ?? "VERIFIED",
      verifiedAt: new Date(),
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function getExecutionLogByIdempotencyKey(idempotencyKey: string) {
  return prisma.executionLog.findFirst({
    where: { idempotencyKey, status: { in: ["SUBMITTED", "FILLED", "VERIFIED", "PARTIALLY_FILLED"] } },
    orderBy: { submittedAt: "desc" },
  });
}

export async function listExecutionLogs(limit = 50) {
  return prisma.executionLog.findMany({ orderBy: { submittedAt: "desc" }, take: limit });
}

export async function persistExecutionReconciliation(input: {
  executionId?: string;
  symbol: string;
  side?: string;
  internalQty?: number;
  exchangeQty?: number;
  internalBalance?: number;
  exchangeBalance?: number;
  status: ExecutionReconciliationStatus;
  mismatchReason?: string;
  repairAction?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.executionReconciliation.create({
    data: {
      reconcileKey: key("exrec"),
      ...input,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function listExecutionReconciliations(limit = 50) {
  return prisma.executionReconciliation.findMany({ orderBy: { reconciledAt: "desc" }, take: limit });
}

export async function listRecentExecutionLogsBySymbol(symbol: string, limit = 20) {
  return prisma.executionLog.findMany({
    where: { symbol: symbol.toUpperCase() },
    orderBy: { submittedAt: "desc" },
    take: limit,
  });
}

export async function listExecutionAudits(limit = 50) {
  return prisma.executionAudit.findMany({ orderBy: { auditedAt: "desc" }, take: limit });
}

export async function listExecutionFailures(limit = 50) {
  return prisma.executionFailure.findMany({ orderBy: { failedAt: "desc" }, take: limit });
}

export async function listOpenPositions(limit = 20) {
  return prisma.position.findMany({
    where: { status: "OPEN" },
    include: { tradingPair: true },
    orderBy: { openedAt: "desc" },
    take: limit,
  });
}
