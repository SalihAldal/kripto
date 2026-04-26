import { Prisma } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";

export async function getRiskConfigByUser(userId: string) {
  return prisma.riskConfig.findUnique({
    where: { userId },
  });
}

export async function upsertRiskConfig(userId: string, payload: {
  status?: "ACTIVE" | "INACTIVE" | "DRAFT";
  profile?: "CONSERVATIVE" | "MODERATE" | "AGGRESSIVE";
  maxLeverage?: number;
  maxOpenPositions?: number;
  maxOrderNotional?: number;
  maxDailyLossPercent?: number;
  maxDrawdownPercent?: number;
  stopLossRequired?: boolean;
  takeProfitRequired?: boolean;
  emergencyBrakeEnabled?: boolean;
  cooldownMinutes?: number;
  metadata?: Record<string, unknown>;
}) {
  const data = {
    ...payload,
    metadata: payload.metadata
      ? (payload.metadata as Prisma.InputJsonValue)
      : undefined,
  };
  return prisma.riskConfig.upsert({
    where: { userId },
    create: {
      userId,
      ...data,
    },
    update: data,
  });
}

export async function getDailyPnlSummary(userId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.profitLossRecord.findMany({
    where: { userId, recordedAt: { gte: since } },
    orderBy: { recordedAt: "desc" },
  });

  const net = rows.reduce((acc, row) => acc + row.netPnl, 0);
  const losses = rows.filter((row) => row.netPnl < 0);
  return {
    netPnl24h: Number(net.toFixed(8)),
    totalRecords: rows.length,
    lossCount: losses.length,
    lossAmountAbs: Number(Math.abs(losses.reduce((acc, row) => acc + row.netPnl, 0)).toFixed(8)),
  };
}

export async function getWeeklyPnlSummary(userId: string) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await prisma.profitLossRecord.findMany({
    where: { userId, recordedAt: { gte: since } },
    orderBy: { recordedAt: "desc" },
  });
  const net = rows.reduce((acc, row) => acc + row.netPnl, 0);
  const losses = rows.filter((row) => row.netPnl < 0);
  return {
    netPnl7d: Number(net.toFixed(8)),
    totalRecords: rows.length,
    lossCount: losses.length,
    lossAmountAbs: Number(Math.abs(losses.reduce((acc, row) => acc + row.netPnl, 0)).toFixed(8)),
  };
}

export async function getConsecutiveLossCount(userId: string, limit = 12) {
  const rows = await prisma.profitLossRecord.findMany({
    where: { userId },
    orderBy: { recordedAt: "desc" },
    take: limit,
  });
  let count = 0;
  for (const row of rows) {
    if (row.netPnl < 0) {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

export async function listOpenPositionsCount(userId: string) {
  return prisma.position.count({
    where: { userId, status: "OPEN" },
  });
}

export async function getAverageSlippage(userId: string, take = 50) {
  const rows = await prisma.tradeOrder.findMany({
    where: { userId, status: "FILLED" },
    orderBy: { executedAt: "desc" },
    take,
    select: { slippage: true },
  });
  if (rows.length === 0) return 0;
  const avg = rows.reduce((acc, row) => acc + row.slippage, 0) / rows.length;
  return Number(avg.toFixed(8));
}

export async function getPausedState(userId: string) {
  const keys = [`system.paused.${userId}`, "system.paused"];
  const row = await prisma.appSetting.findFirst({
    where: { key: { in: keys }, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return { paused: false };
  const value = row.value as Record<string, unknown>;
  const until = typeof value?.until === "string" ? value.until : undefined;
  const untilMs = until ? new Date(until).getTime() : 0;
  const expired = Boolean(until && Number.isFinite(untilMs) && untilMs <= Date.now());
  return {
    paused: expired ? false : Boolean(value?.paused),
    reason: typeof value?.reason === "string" ? value.reason : undefined,
    until,
  };
}

export async function setPausedState(input: {
  userId?: string;
  paused: boolean;
  reason?: string;
  until?: string;
}) {
  const key = input.userId ? `system.paused.${input.userId}` : "system.paused";
  return prisma.appSetting.upsert({
    where: { key },
    create: {
      key,
      scope: input.userId ? "USER" : "GLOBAL",
      userId: input.userId,
      value: {
        paused: input.paused,
        reason: input.reason ?? null,
        until: input.until ?? null,
      },
      valueType: "json",
      status: "ACTIVE",
      description: "System paused state for risk breaker",
    },
    update: {
      value: {
        paused: input.paused,
        reason: input.reason ?? null,
        until: input.until ?? null,
      },
      status: "ACTIVE",
    },
  });
}

export async function getApiFailureState(userId: string) {
  const key = `risk.api_failures.${userId}`;
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const value = (row?.value as Record<string, unknown> | undefined) ?? {};
  return {
    count: Number(value.count ?? 0),
    lastFailureAt: typeof value.lastFailureAt === "string" ? value.lastFailureAt : undefined,
    blockedUntil: typeof value.blockedUntil === "string" ? value.blockedUntil : undefined,
  };
}

export async function setApiFailureState(userId: string, value: { count: number; lastFailureAt?: string; blockedUntil?: string }) {
  const key = `risk.api_failures.${userId}`;
  return prisma.appSetting.upsert({
    where: { key },
    create: {
      key,
      scope: "USER",
      userId,
      value,
      valueType: "json",
      status: "ACTIVE",
    },
    update: {
      value,
      status: "ACTIVE",
    },
  });
}
