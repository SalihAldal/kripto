import { Prisma } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import { getOrderStatus } from "@/services/binance.service";
import { getRuntimeExecutionContext, listOpenPositionsByUser, updateOrderStatus } from "@/src/server/repositories/execution.repository";
import { listPendingOrdersByUser } from "@/src/server/repositories/trade.repository";
import { writeStructuredLog } from "@/src/server/observability/structured-log";

type SafeModeState = {
  enabled: boolean;
  reason?: string;
  requireManualAck: boolean;
  updatedAt: string;
  lastRecoveryAt?: string;
  unresolvedOrders?: Array<{ orderId: string; symbol: string; reason: string }>;
};

const SAFE_MODE_PREFIX = "failsafe.safe_mode";
const ANALYSIS_STATE_PREFIX = "failsafe.analysis_state";
const ROUND_STATE_PREFIX = "failsafe.round_state";
const LAST_EVENT_PREFIX = "failsafe.last_event";
const RECONCILE_STATE_PREFIX = "failsafe.reconcile_state";
const IDEMPOTENCY_PREFIX = "failsafe.idempotency";

function buildKey(prefix: string, userId: string) {
  return `${prefix}.${userId}`;
}

function normalizeOrderStatus(raw: unknown) {
  const upper = String(raw ?? "").toUpperCase();
  if (upper.includes("PARTIALLY")) return "PARTIALLY_FILLED" as const;
  if (upper.includes("FILLED")) return "FILLED" as const;
  if (upper.includes("CANCELED")) return "CANCELED" as const;
  if (upper.includes("EXPIRED")) return "EXPIRED" as const;
  if (upper.includes("REJECT")) return "REJECTED" as const;
  return "NEW" as const;
}

async function upsertUserSetting(userId: string, key: string, value: Prisma.InputJsonValue, description: string) {
  const userExists = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!userExists) return null;
  return prisma.appSetting.upsert({
    where: { key },
    create: {
      key,
      scope: "USER",
      userId,
      value,
      valueType: "json",
      status: "ACTIVE",
      description,
    },
    update: {
      value,
      status: "ACTIVE",
    },
  });
}

export async function getSafeModeState(userId?: string): Promise<SafeModeState> {
  const { user } = await getRuntimeExecutionContext(userId);
  const key = buildKey(SAFE_MODE_PREFIX, user.id);
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const value = (row?.value as Record<string, unknown> | undefined) ?? {};
  return {
    enabled: Boolean(value.enabled),
    reason: typeof value.reason === "string" ? value.reason : undefined,
    requireManualAck: Boolean(value.requireManualAck ?? false),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    lastRecoveryAt: typeof value.lastRecoveryAt === "string" ? value.lastRecoveryAt : undefined,
    unresolvedOrders: Array.isArray(value.unresolvedOrders)
      ? (value.unresolvedOrders as Array<{ orderId: string; symbol: string; reason: string }>)
      : [],
  };
}

export async function setSafeModeState(input: {
  userId?: string;
  enabled: boolean;
  reason?: string;
  requireManualAck?: boolean;
  unresolvedOrders?: Array<{ orderId: string; symbol: string; reason: string }>;
}) {
  const { user } = await getRuntimeExecutionContext(input.userId);
  const key = buildKey(SAFE_MODE_PREFIX, user.id);
  const value = {
    enabled: input.enabled,
    reason: input.reason ?? null,
    requireManualAck: Boolean(input.requireManualAck ?? false),
    updatedAt: new Date().toISOString(),
    unresolvedOrders: input.unresolvedOrders ?? [],
  };
  await upsertUserSetting(user.id, key, value as Prisma.InputJsonValue, "Failsafe safe mode state");
  await writeStructuredLog({
    level: input.enabled ? "WARN" : "INFO",
    source: "failsafe-service",
    message: input.enabled ? "Safe mode enabled" : "Safe mode disabled",
    actionType: "settings_updated",
    status: input.enabled ? "RUNNING" : "SUCCESS",
    userId: user.id,
    errorCode: input.enabled ? "SAFE_MODE_ACTIVE" : undefined,
    errorDetail: input.reason,
    context: value,
  });
  return value;
}

export async function persistAnalysisState(input: {
  userId?: string;
  executionId: string;
  symbol?: string;
  stage: string;
  status: "RUNNING" | "SUCCESS" | "FAILED";
}) {
  const { user } = await getRuntimeExecutionContext(input.userId);
  const key = buildKey(ANALYSIS_STATE_PREFIX, user.id);
  await upsertUserSetting(
    user.id,
    key,
    {
      executionId: input.executionId,
      symbol: input.symbol ?? null,
      stage: input.stage,
      status: input.status,
      updatedAt: new Date().toISOString(),
    } as Prisma.InputJsonValue,
    "Active analysis state snapshot",
  );
}

export async function persistRoundState(input: {
  userId?: string;
  jobId: string;
  roundNo?: number;
  state: string;
  symbol?: string;
  status: "RUNNING" | "SUCCESS" | "FAILED";
}) {
  const { user } = await getRuntimeExecutionContext(input.userId);
  const key = buildKey(ROUND_STATE_PREFIX, user.id);
  await upsertUserSetting(
    user.id,
    key,
    {
      jobId: input.jobId,
      roundNo: input.roundNo ?? null,
      state: input.state,
      symbol: input.symbol ?? null,
      status: input.status,
      updatedAt: new Date().toISOString(),
    } as Prisma.InputJsonValue,
    "Active round state snapshot",
  );
}

export async function persistLastEvent(input: {
  userId?: string;
  executionId?: string;
  symbol?: string;
  stage: string;
  status: string;
  message: string;
}) {
  const { user } = await getRuntimeExecutionContext(input.userId);
  const key = buildKey(LAST_EVENT_PREFIX, user.id);
  await upsertUserSetting(
    user.id,
    key,
    {
      executionId: input.executionId ?? null,
      symbol: input.symbol ?? null,
      stage: input.stage,
      status: input.status,
      message: input.message,
      updatedAt: new Date().toISOString(),
    } as Prisma.InputJsonValue,
    "Last critical event snapshot",
  );
}

export async function getIdempotentExecution(userId: string, idempotencyKey: string) {
  const key = `${IDEMPOTENCY_PREFIX}.${userId}.${idempotencyKey}`;
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row) return null;
  return row.value as Record<string, unknown>;
}

export async function setIdempotentExecution(userId: string, idempotencyKey: string, value: Record<string, unknown>) {
  const key = `${IDEMPOTENCY_PREFIX}.${userId}.${idempotencyKey}`;
  await upsertUserSetting(userId, key, value as Prisma.InputJsonValue, "Execution idempotency key");
}

export async function runRestartRecovery(userId?: string) {
  const { user } = await getRuntimeExecutionContext(userId);
  const openPositions = await listOpenPositionsByUser(user.id);
  const pendingOrders = await listPendingOrdersByUser(user.id);
  const unresolvedOrders: Array<{ orderId: string; symbol: string; reason: string }> = [];
  const syncedOrders: Array<{ orderId: string; symbol: string; status: string }> = [];

  for (const order of pendingOrders) {
    if (!order.exchangeOrderId) {
      unresolvedOrders.push({ orderId: order.id, symbol: order.tradingPair.symbol, reason: "missing_exchange_order_id" });
      continue;
    }
    try {
      const remote = await Promise.race([
        getOrderStatus(order.tradingPair.symbol, order.exchangeOrderId),
        new Promise((_, reject) => setTimeout(() => reject(new Error("order_status_timeout")), 3500)),
      ]);
      const normalized = normalizeOrderStatus((remote as Record<string, unknown>).status);
      if (normalized === "NEW" || normalized === "PARTIALLY_FILLED") {
        unresolvedOrders.push({ orderId: order.id, symbol: order.tradingPair.symbol, reason: "still_open_remote" });
        continue;
      }
      await updateOrderStatus({
        orderId: order.id,
        status: normalized,
        executedAt: normalized === "FILLED" ? new Date() : undefined,
        canceledAt: normalized === "CANCELED" ? new Date() : undefined,
      });
      syncedOrders.push({ orderId: order.id, symbol: order.tradingPair.symbol, status: normalized });
    } catch (error) {
      unresolvedOrders.push({
        orderId: order.id,
        symbol: order.tradingPair.symbol,
        reason: (error as Error).message,
      });
    }
  }

  const conflictDetected = unresolvedOrders.length > 0 && openPositions.length > 0;
  if (conflictDetected) {
    await setSafeModeState({
      userId: user.id,
      enabled: true,
      reason: "Recovery conflict: unresolved order status while open positions exist",
      requireManualAck: true,
      unresolvedOrders,
    });
  }

  await upsertUserSetting(
    user.id,
    buildKey(RECONCILE_STATE_PREFIX, user.id),
    {
      openPositions: openPositions.map((p) => ({ id: p.id, symbol: p.tradingPair.symbol, status: p.status })),
      pendingOrders: pendingOrders.map((o) => ({ id: o.id, symbol: o.tradingPair.symbol, status: o.status })),
      syncedOrders,
      unresolvedOrders,
      conflictDetected,
      recoveredAt: new Date().toISOString(),
    } as Prisma.InputJsonValue,
    "Restart recovery reconciliation snapshot",
  );

  await writeStructuredLog({
    level: conflictDetected ? "WARN" : "INFO",
    source: "failsafe-service",
    message: "Restart recovery reconciliation completed",
    actionType: "recovery_after_restart",
    status: conflictDetected ? "FAILED" : "SUCCESS",
    userId: user.id,
    errorCode: conflictDetected ? "RECOVERY_CONFLICT" : undefined,
    errorDetail: conflictDetected ? "safe_mode_required" : undefined,
    context: {
      openPositionCount: openPositions.length,
      pendingOrderCount: pendingOrders.length,
      unresolvedOrders,
      syncedOrderCount: syncedOrders.length,
    },
  });

  return {
    openPositionCount: openPositions.length,
    pendingOrderCount: pendingOrders.length,
    unresolvedOrders,
    syncedOrders,
    conflictDetected,
  };
}
