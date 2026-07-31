import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { TradeQualityScores } from "@/src/server/paper-validation/paper-validation.types";

export async function ensurePaperPortfolio(userId: string) {
  const existing = await prisma.paperPortfolio.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.paperPortfolio.create({ data: { userId } });
}

export async function updatePaperPortfolio(input: {
  userId: string;
  balance?: number;
  availableBalance?: number;
  lockedBalance?: number;
  totalPnl?: number;
  totalFees?: number;
  totalSlippage?: number;
  unrealizedPnl?: number;
  positionCount?: number;
  metadata?: Record<string, unknown>;
}) {
  await ensurePaperPortfolio(input.userId);
  return prisma.paperPortfolio.update({
    where: { userId: input.userId },
    data: {
      balance: input.balance,
      availableBalance: input.availableBalance,
      lockedBalance: input.lockedBalance,
      totalPnl: input.totalPnl,
      totalFees: input.totalFees,
      totalSlippage: input.totalSlippage,
      unrealizedPnl: input.unrealizedPnl,
      positionCount: input.positionCount,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function upsertPaperTrade(input: {
  tradeKey: string;
  userId: string;
  portfolioId?: string;
  symbol: string;
  side: "BUY" | "SELL";
  status?: "OPEN" | "CLOSED" | "CANCELLED";
  strategy?: string;
  marketRegime?: string;
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  avgEntryPrice?: number;
  realizedPnl?: number;
  returnPct?: number;
  fees?: number;
  slippagePct?: number;
  holdSec?: number;
  decisionId?: string;
  executionId?: string;
  positionId?: string;
  simulationId?: string;
  scores?: TradeQualityScores;
  openedAt?: Date;
  closedAt?: Date;
  metadata?: Record<string, unknown>;
}) {
  const portfolio = await ensurePaperPortfolio(input.userId);
  return prisma.paperTrade.upsert({
    where: { tradeKey: input.tradeKey },
    create: {
      tradeKey: input.tradeKey,
      userId: input.userId,
      portfolioId: input.portfolioId ?? portfolio.id,
      symbol: input.symbol,
      side: input.side,
      status: input.status ?? "OPEN",
      strategy: input.strategy,
      marketRegime: input.marketRegime,
      entryPrice: input.entryPrice,
      exitPrice: input.exitPrice,
      quantity: input.quantity,
      avgEntryPrice: input.avgEntryPrice ?? input.entryPrice,
      realizedPnl: input.realizedPnl ?? 0,
      returnPct: input.returnPct ?? 0,
      fees: input.fees ?? 0,
      slippagePct: input.slippagePct ?? 0,
      holdSec: input.holdSec,
      decisionId: input.decisionId,
      executionId: input.executionId,
      positionId: input.positionId,
      simulationId: input.simulationId,
      tradeQualityScore: input.scores?.tradeQualityScore,
      entryScore: input.scores?.entryScore,
      exitScore: input.scores?.exitScore,
      executionScore: input.scores?.executionScore,
      decisionScore: input.scores?.decisionScore,
      riskScore: input.scores?.riskScore,
      overallScore: input.scores?.overallScore,
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
      tradeQualityScore: input.scores?.tradeQualityScore,
      entryScore: input.scores?.entryScore,
      exitScore: input.scores?.exitScore,
      executionScore: input.scores?.executionScore,
      decisionScore: input.scores?.decisionScore,
      riskScore: input.scores?.riskScore,
      overallScore: input.scores?.overallScore,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function createPaperExecution(input: {
  executionKey: string;
  paperTradeId: string;
  simulationId?: string;
  executionId?: string;
  side: string;
  requestedQty?: number;
  executedQty: number;
  requestedPrice?: number;
  avgFillPrice: number;
  spreadPct?: number;
  slippagePct?: number;
  fee?: number;
  latencyMs?: number;
  fillCount?: number;
  bidPrice?: number;
  askPrice?: number;
  depthUsed?: number;
  expectedFillPrice?: number;
  fillAccuracyPct?: number;
  priceDifference?: number;
  latencyDifferenceMs?: number;
  metadata?: Record<string, unknown>;
}) {
  return prisma.paperExecution.upsert({
    where: { executionKey: input.executionKey },
    create: {
      executionKey: input.executionKey,
      paperTradeId: input.paperTradeId,
      simulationId: input.simulationId,
      executionId: input.executionId,
      side: input.side,
      requestedQty: input.requestedQty,
      executedQty: input.executedQty,
      requestedPrice: input.requestedPrice,
      avgFillPrice: input.avgFillPrice,
      spreadPct: input.spreadPct,
      slippagePct: input.slippagePct,
      fee: input.fee ?? 0,
      latencyMs: input.latencyMs,
      fillCount: input.fillCount ?? 1,
      bidPrice: input.bidPrice,
      askPrice: input.askPrice,
      depthUsed: input.depthUsed,
      expectedFillPrice: input.expectedFillPrice,
      fillAccuracyPct: input.fillAccuracyPct,
      priceDifference: input.priceDifference,
      latencyDifferenceMs: input.latencyDifferenceMs,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
    update: {
      executedQty: input.executedQty,
      avgFillPrice: input.avgFillPrice,
      fee: input.fee,
      fillAccuracyPct: input.fillAccuracyPct,
      priceDifference: input.priceDifference,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function getPaperValidationDashboard(userId?: string) {
  const userFilter = userId ? { userId } : {};
  const [portfolios, trades, reports, coinPerf, sessionPerf, readiness, missed, jobStates] = await Promise.all([
    prisma.paperPortfolio.findMany({ orderBy: { updatedAt: "desc" }, take: userId ? 1 : 20 }),
    prisma.paperTrade.findMany({
      where: userFilter,
      orderBy: { openedAt: "desc" },
      take: 50,
      include: { executions: { take: 2, orderBy: { executedAt: "desc" } } },
    }),
    prisma.dailyPaperReport.findMany({
      where: userFilter,
      orderBy: { reportDate: "desc" },
      take: 14,
    }),
    prisma.coinPerformance.findMany({
      where: userFilter,
      orderBy: { winRate: "desc" },
      take: 25,
    }),
    prisma.sessionPerformance.findMany({
      where: userFilter,
      orderBy: { tradeCount: "desc" },
      take: 20,
    }),
    prisma.liveReadiness.findMany({
      where: userFilter,
      orderBy: { reportDate: "desc" },
      take: 7,
    }),
    prisma.paperMissedOpportunity.findMany({
      where: userFilter,
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.paperValidationJobState.findMany({ orderBy: { updatedAt: "desc" } }),
  ]);

  const closedTrades = trades.filter((t) => t.status === "CLOSED");
  const wins = closedTrades.filter((t) => t.returnPct > 0);
  const summary = {
    totalTrades: trades.length,
    closedTrades: closedTrades.length,
    openTrades: trades.filter((t) => t.status === "OPEN").length,
    winRate: closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0,
    totalPnl: closedTrades.reduce((s, t) => s + t.realizedPnl, 0),
    avgQualityScore:
      closedTrades.length > 0
        ? closedTrades.reduce((s, t) => s + (t.overallScore ?? 0), 0) / closedTrades.length
        : 0,
  };

  return {
    portfolios,
    trades,
    reports,
    coinPerformance: coinPerf,
    sessionPerformance: sessionPerf,
    readiness,
    missedOpportunities: missed,
    jobStates,
    summary,
    sandbox: { isolated: true, autoLiveEnabled: false },
  };
}

export async function listActivePaperUserIds(limit = 50) {
  const rows = await prisma.paperTrade.findMany({
    distinct: ["userId"],
    select: { userId: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  if (rows.length > 0) return rows.map((r) => r.userId);

  const positions = await prisma.position.findMany({
    where: { status: "OPEN" },
    select: { userId: true },
    distinct: ["userId"],
    take: limit,
  });
  return positions.map((p) => p.userId);
}
