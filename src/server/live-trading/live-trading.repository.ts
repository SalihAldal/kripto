import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { CircuitBreakerReason, KillSwitchSource, LiveAlertChannel, LiveAlertSeverity } from "@prisma/client";

export async function upsertLiveTrade(input: {
  tradeKey: string;
  userId: string;
  symbol: string;
  side: string;
  status?: "OPEN" | "CLOSED" | "CANCELLED" | "RECOVERED";
  strategy?: string;
  marketRegime?: string;
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  realizedPnl?: number;
  returnPct?: number;
  fees?: number;
  slippagePct?: number;
  holdSec?: number;
  decisionId?: string;
  executionId?: string;
  positionId?: string;
  modelVersion?: string;
  openedAt?: Date;
  closedAt?: Date;
  metadata?: Record<string, unknown>;
}) {
  return prisma.liveTrade.upsert({
    where: { tradeKey: input.tradeKey },
    create: {
      tradeKey: input.tradeKey,
      userId: input.userId,
      symbol: input.symbol,
      side: input.side,
      status: input.status ?? "OPEN",
      strategy: input.strategy,
      marketRegime: input.marketRegime,
      entryPrice: input.entryPrice,
      exitPrice: input.exitPrice,
      quantity: input.quantity,
      realizedPnl: input.realizedPnl ?? 0,
      returnPct: input.returnPct ?? 0,
      fees: input.fees ?? 0,
      slippagePct: input.slippagePct ?? 0,
      holdSec: input.holdSec,
      decisionId: input.decisionId,
      executionId: input.executionId,
      positionId: input.positionId,
      modelVersion: input.modelVersion,
      openedAt: input.openedAt,
      closedAt: input.closedAt,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
    update: {
      status: input.status,
      exitPrice: input.exitPrice,
      realizedPnl: input.realizedPnl,
      returnPct: input.returnPct,
      fees: input.fees,
      slippagePct: input.slippagePct,
      holdSec: input.holdSec,
      closedAt: input.closedAt,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function recordLiveExecution(input: {
  executionKey: string;
  userId: string;
  liveTradeId?: string;
  executionId?: string;
  logKey?: string;
  symbol: string;
  side: string;
  orderRequest?: Record<string, unknown>;
  exchangeResponse?: Record<string, unknown>;
  requestedQty?: number;
  executedQty: number;
  requestedPrice?: number;
  fillPrice: number;
  commission?: number;
  slippagePct?: number;
  latencyMs?: number;
  executionConfidence?: number;
  executionResult?: string;
  metadata?: Record<string, unknown>;
}) {
  const execution = await prisma.liveExecution.upsert({
    where: { executionKey: input.executionKey },
    create: {
      executionKey: input.executionKey,
      liveTradeId: input.liveTradeId,
      userId: input.userId,
      executionId: input.executionId,
      logKey: input.logKey,
      symbol: input.symbol,
      side: input.side,
      orderRequest: input.orderRequest as Prisma.InputJsonValue,
      exchangeResponse: input.exchangeResponse as Prisma.InputJsonValue,
      requestedQty: input.requestedQty,
      executedQty: input.executedQty,
      requestedPrice: input.requestedPrice,
      fillPrice: input.fillPrice,
      commission: input.commission ?? 0,
      slippagePct: input.slippagePct ?? 0,
      latencyMs: input.latencyMs,
      executionConfidence: input.executionConfidence,
      executionResult: input.executionResult ?? "FILLED",
      metadata: input.metadata as Prisma.InputJsonValue,
    },
    update: {
      executedQty: input.executedQty,
      fillPrice: input.fillPrice,
      commission: input.commission,
      slippagePct: input.slippagePct,
      latencyMs: input.latencyMs,
      executionResult: input.executionResult,
    },
  });

  await prisma.liveExecutionAudit.upsert({
    where: { liveExecutionId: execution.id },
    create: {
      liveExecutionId: execution.id,
      orderRequest: input.orderRequest as Prisma.InputJsonValue,
      exchangeResponse: input.exchangeResponse as Prisma.InputJsonValue,
      latencyMs: input.latencyMs,
      fillPrice: input.fillPrice,
      commission: input.commission,
      slippagePct: input.slippagePct,
      executionResult: input.executionResult ?? "FILLED",
      executionConfidence: input.executionConfidence,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
    update: {
      fillPrice: input.fillPrice,
      commission: input.commission,
      slippagePct: input.slippagePct,
      latencyMs: input.latencyMs,
    },
  });

  return execution;
}

export async function triggerCircuitBreaker(input: {
  userId?: string;
  reason: CircuitBreakerReason;
  message: string;
  evidence?: Record<string, unknown>;
}) {
  return prisma.circuitBreakerEvent.create({
    data: {
      userId: input.userId,
      reason: input.reason,
      active: true,
      message: input.message,
      evidence: input.evidence as Prisma.InputJsonValue,
    },
  });
}

export async function activateKillSwitch(input: {
  userId?: string;
  source: KillSwitchSource;
  reason: string;
  triggeredBy?: string;
  evidence?: Record<string, unknown>;
}) {
  return prisma.killSwitchEvent.create({
    data: {
      userId: input.userId,
      source: input.source,
      active: true,
      reason: input.reason,
      triggeredBy: input.triggeredBy,
      evidence: input.evidence as Prisma.InputJsonValue,
    },
  });
}

export async function persistLiveAlert(input: {
  userId?: string;
  channel: LiveAlertChannel;
  severity: LiveAlertSeverity;
  eventType: string;
  title: string;
  message: string;
  delivered?: boolean;
  metadata?: Record<string, unknown>;
}) {
  return prisma.liveAlert.create({
    data: {
      userId: input.userId,
      channel: input.channel,
      severity: input.severity,
      eventType: input.eventType,
      title: input.title,
      message: input.message,
      delivered: input.delivered ?? false,
      deliveredAt: input.delivered ? new Date() : undefined,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function ensureCapitalProtection(userId: string) {
  const existing = await prisma.capitalProtection.findUnique({ where: { userId } });
  if (existing) return existing;
  const { env } = await import("@/lib/config");
  return prisma.capitalProtection.create({
    data: {
      userId,
      dailyLossLimitPct: env.LIVE_TRADING_MAX_DAILY_LOSS_PCT,
      maxDailyTrades: env.LIVE_TRADING_MAX_DAILY_TRADES,
      maxOpenPositions: env.LIVE_TRADING_MAX_OPEN_POSITIONS,
      maxConsecutiveLosses: env.LIVE_TRADING_MAX_CONSECUTIVE_LOSSES,
      maxPositionSizePct: env.LIVE_TRADING_MAX_POSITION_SIZE_PCT,
      maxExposurePct: env.LIVE_TRADING_MAX_EXPOSURE_PCT,
      maxCoinExposurePct: env.LIVE_TRADING_MAX_COIN_EXPOSURE_PCT,
    },
  });
}

export async function getLiveTradingDashboard(userId?: string) {
  const userFilter = userId ? { userId } : {};
  const [
    trades,
    executions,
    readiness,
    health,
    capital,
    circuitBreakers,
    killSwitches,
    alerts,
    reports,
    jobStates,
  ] = await Promise.all([
    prisma.liveTrade.findMany({ where: userFilter, orderBy: { openedAt: "desc" }, take: 30 }),
    prisma.liveExecution.findMany({ where: userFilter, orderBy: { executedAt: "desc" }, take: 20, include: { audit: true } }),
    userId ? prisma.liveReadiness.findFirst({ where: { userId }, orderBy: { reportDate: "desc" } }) : null,
    prisma.productionHealth.findFirst({ where: userId ? { userId } : {}, orderBy: { recordedAt: "desc" } }),
    userId ? prisma.capitalProtection.findUnique({ where: { userId } }) : null,
    prisma.circuitBreakerEvent.findMany({ where: { active: true }, orderBy: { triggeredAt: "desc" }, take: 10 }),
    prisma.killSwitchEvent.findMany({ where: { active: true }, orderBy: { triggeredAt: "desc" }, take: 10 }),
    prisma.liveAlert.findMany({ where: userFilter, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.productionReport.findMany({ where: userFilter, orderBy: { reportDate: "desc" }, take: 10 }),
    prisma.liveTradingJobState.findMany({ orderBy: { updatedAt: "desc" } }),
  ]);

  const closedTrades = trades.filter((t) => t.status === "CLOSED");
  return {
    trades,
    executions,
    readiness,
    health,
    capital,
    circuitBreakers,
    killSwitches,
    alerts,
    reports,
    jobStates,
    summary: {
      totalTrades: trades.length,
      openTrades: trades.filter((t) => t.status === "OPEN").length,
      closedTrades: closedTrades.length,
      totalPnl: closedTrades.reduce((s, t) => s + t.realizedPnl, 0),
      winRate: closedTrades.length > 0 ? (closedTrades.filter((t) => t.returnPct > 0).length / closedTrades.length) * 100 : 0,
    },
    autoLiveEnabled: false,
  };
}

export async function listActiveLiveUserIds(limit = 50) {
  const rows = await prisma.liveTrade.findMany({ distinct: ["userId"], select: { userId: true }, take: limit });
  if (rows.length > 0) return rows.map((r) => r.userId);
  const positions = await prisma.position.findMany({
    where: { status: "OPEN" },
    distinct: ["userId"],
    select: { userId: true },
    take: limit,
  });
  return positions.map((p) => p.userId);
}
