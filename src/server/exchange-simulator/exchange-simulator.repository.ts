import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { MarketSimulationResult } from "@/src/server/exchange-simulator/exchange-simulator.types";
import { analyzeLatencySamples } from "@/src/server/exchange-simulator/latency-simulator";

export async function persistExecutionSimulation(input: {
  executionId?: string;
  userId?: string;
  result: MarketSimulationResult;
}) {
  const { result } = input;
  return prisma.$transaction(async (tx) => {
    const simulation = await tx.executionSimulation.create({
      data: {
        id: result.simulationId,
        executionId: input.executionId,
        userId: input.userId,
        orderId: result.orderId,
        symbol: result.symbol,
        exchange: String(result.metadata?.exchange ?? "BINANCE_TR"),
        side: result.side,
        orderType: result.orderType,
        requestedQty: result.requestedQty,
        executedQty: result.executedQty,
        requestedPrice: result.requestedPrice,
        avgFillPrice: result.avgFillPrice,
        remainingQty: result.remainingQty,
        fillCount: result.fillCount,
        totalFees: result.totalFees,
        totalSlippagePct: result.totalSlippagePct,
        executionDurationMs: result.executionDurationMs,
        status: result.status,
        metadata: result.metadata as Prisma.InputJsonValue,
      },
    });

    if (result.fills.length > 0) {
      await tx.executionFill.createMany({
        data: result.fills.map((fill) => ({
          simulationId: simulation.id,
          fillIndex: fill.fillIndex,
          quantity: fill.quantity,
          price: fill.price,
          notional: fill.notional,
          fee: fill.fee,
          slippagePct: fill.slippagePct,
          filledAt: new Date(fill.filledAt),
        })),
      });
      await tx.executionFee.createMany({
        data: result.fills.map((fill) => ({
          simulationId: simulation.id,
          fillIndex: fill.fillIndex,
          feeType: "TAKER",
          feeRate: fill.notional > 0 ? fill.fee / fill.notional : 0,
          feeAmount: fill.fee,
          notional: fill.notional,
        })),
      });
    }

    await tx.executionLatency.create({
      data: {
        simulationId: simulation.id,
        networkMs: result.latency.networkMs,
        exchangeMs: result.latency.exchangeMs,
        queueMs: result.latency.queueMs,
        matchingMs: result.latency.matchingMs,
        totalMs: result.latency.totalMs,
      },
    });

    await tx.executionQuality.create({
      data: {
        simulationId: simulation.id,
        overallScore: result.quality.overallScore,
        slippageScore: result.quality.slippageScore,
        liquidityScore: result.quality.liquidityScore,
        spreadScore: result.quality.spreadScore,
        fillScore: result.quality.fillScore,
        latencyScore: result.quality.latencyScore,
      },
    });

    await tx.executionSlippage.create({
      data: {
        simulationId: simulation.id,
        slippagePct: result.slippage.slippagePct,
        slippageBps: result.slippage.slippageBps,
        bestPrice: result.slippage.bestPrice,
        worstPrice: result.slippage.worstPrice,
        midPrice: result.slippage.midPrice,
        spreadPct: result.slippage.spreadPct,
        impactPct: result.slippage.impactPct,
      },
    });

    await tx.executionComparison.create({
      data: {
        simulationId: simulation.id,
        requestedPrice: result.comparison.requestedPrice,
        executedPrice: result.comparison.executedPrice,
        bestPossiblePrice: result.comparison.bestPossiblePrice,
        worstPossiblePrice: result.comparison.worstPossiblePrice,
        slippagePct: result.comparison.slippagePct,
        fees: result.comparison.fees,
        executionTimeMs: result.comparison.executionTimeMs,
        improvementBps: result.comparison.improvementBps,
      },
    });

    return simulation;
  });
}

export async function getSimulationById(simulationId: string) {
  return prisma.executionSimulation.findUnique({
    where: { id: simulationId },
    include: {
      fills: { orderBy: { fillIndex: "asc" } },
      latency: true,
      quality: true,
      slippage: true,
      fees: true,
      comparison: true,
    },
  });
}

export async function listSimulations(input?: { executionId?: string; symbol?: string; limit?: number }) {
  return prisma.executionSimulation.findMany({
    where: {
      executionId: input?.executionId,
      symbol: input?.symbol?.toUpperCase(),
    },
    include: {
      fills: { orderBy: { fillIndex: "asc" } },
      latency: true,
      quality: true,
      slippage: true,
      comparison: true,
    },
    orderBy: { simulatedAt: "desc" },
    take: input?.limit ?? 100,
  });
}

export async function getSimulatorDashboardMetrics(periodHours = 24) {
  const since = new Date(Date.now() - periodHours * 60 * 60 * 1000);
  const rows = await prisma.executionSimulation.findMany({
    where: { simulatedAt: { gte: since } },
    include: { slippage: true, latency: true, quality: true, comparison: true, fills: true },
    orderBy: { simulatedAt: "desc" },
    take: 500,
  });

  const slippages = rows.map((row) => row.totalSlippagePct ?? row.slippage?.slippagePct ?? 0).filter((v) => v >= 0);
  const fees = rows.map((row) => row.totalFees ?? 0);
  const delays = rows.map((row) => row.executionDurationMs ?? row.latency?.totalMs ?? 0);
  const fillCounts = rows.map((row) => row.fillCount ?? 1);
  const success = rows.filter((row) => row.status === "FILLED" || row.status === "PARTIALLY_FILLED").length;
  const failure = rows.filter((row) => row.status === "REJECTED").length;
  const latencies = rows.map((row) => row.latency).filter(Boolean) as Array<{
    networkMs: number;
    exchangeMs: number;
    queueMs: number;
    matchingMs: number;
    totalMs: number;
  }>;

  return {
    periodHours,
    count: rows.length,
    avgSlippagePct: slippages.length ? slippages.reduce((a, b) => a + b, 0) / slippages.length : 0,
    worstSlippagePct: slippages.length ? Math.max(...slippages) : 0,
    bestSlippagePct: slippages.length ? Math.min(...slippages) : 0,
    avgFee: fees.length ? fees.reduce((a, b) => a + b, 0) / fees.length : 0,
    avgExecutionDelayMs: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 0,
    avgFillCount: fillCounts.length ? fillCounts.reduce((a, b) => a + b, 0) / fillCounts.length : 0,
    executionSuccess: success,
    executionFailure: failure,
    avgQualityScore:
      rows.length > 0 ? rows.reduce((sum, row) => sum + (row.quality?.overallScore ?? 0), 0) / rows.length : 0,
    latencyAnalysis: analyzeLatencySamples(latencies),
    recent: rows.slice(0, 20),
  };
}

export async function getSlippageDashboard(periodHours = 24) {
  const dashboard = await getSimulatorDashboardMetrics(periodHours);
  const rows = dashboard.recent;
  return {
    periodHours,
    avgSlippagePct: dashboard.avgSlippagePct,
    worstSlippagePct: dashboard.worstSlippagePct,
    bestSlippagePct: dashboard.bestSlippagePct,
    rows: rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      side: row.side,
      slippagePct: row.totalSlippagePct ?? row.slippage?.slippagePct ?? 0,
      spreadPct: row.slippage?.spreadPct ?? 0,
      impactPct: row.slippage?.impactPct ?? 0,
      simulatedAt: row.simulatedAt,
    })),
  };
}

export async function getFeeDashboard(periodHours = 24) {
  const since = new Date(Date.now() - periodHours * 60 * 60 * 1000);
  const rows = await prisma.executionFee.findMany({
    where: { simulation: { simulatedAt: { gte: since } } },
    include: { simulation: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const totalFees = rows.reduce((sum, row) => sum + (row.feeAmount ?? 0), 0);
  return {
    periodHours,
    totalFees,
    avgFee: rows.length ? totalFees / rows.length : 0,
    rows,
  };
}

export async function getExecutionTimeline(limit = 100) {
  return listSimulations({ limit });
}
