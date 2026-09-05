import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import type { TradeQualityScores } from "@/src/server/paper-validation/paper-validation.types";
import {
  createPaperExecution,
  upsertPaperTrade,
} from "@/src/server/paper-validation/paper-validation.repository";

export async function recordPaperFillEvent(input: {
  campaignId?: string;
  userId: string;
  simulationId: string;
  executionId?: string;
  positionId?: string;
  symbol: string;
  side: "BUY" | "SELL";
  executedQty: number;
  avgFillPrice: number;
  fee: number;
  fillCount?: number;
}) {
  const simulation = await prisma.executionSimulation.findUnique({
    where: { id: input.simulationId },
    include: {
      slippage: true,
      quality: true,
      comparison: true,
      latency: true,
    },
  });

  const position = !input.positionId && input.executionId && input.side === "SELL"
    ? await prisma.position.findFirst({
        where: {
          userId: input.userId,
          status: "CLOSED",
        },
        orderBy: { updatedAt: "desc" },
        include: { tradingPair: true },
      })
    : null;

  const decisionLog = input.executionId
    ? await prisma.decisionLog.findFirst({
        where: {
          OR: [
            { analysisId: input.executionId },
            { metadata: { path: ["executionId"], equals: input.executionId } },
          ],
        },
        orderBy: { createdAt: "desc" },
      })
    : null;

  const tradeKey =
    input.side === "BUY"
      ? `paper_${input.userId}_${input.symbol}_${input.simulationId}`
      : `paper_close_${input.userId}_${input.symbol}_${input.simulationId}`;

  const scores = computeTradeQualityScores({
    simulation,
    decisionLog,
  });

  const accuracy = computeFillAccuracy(simulation, input.avgFillPrice);

  if (input.side === "BUY") {
    const trade = await upsertPaperTrade({
      campaignId: input.campaignId,
      tradeKey,
      userId: input.userId,
      symbol: input.symbol,
      side: "BUY",
      status: "OPEN",
      entryPrice: input.avgFillPrice,
      quantity: input.executedQty,
      avgEntryPrice: input.avgFillPrice,
      fees: input.fee,
      slippagePct: simulation?.totalSlippagePct ?? 0,
      decisionId: decisionLog?.decisionId,
      executionId: input.executionId,
      positionId: input.positionId ?? position?.id,
      simulationId: input.simulationId,
      strategy: decisionLog?.strategyUsed ?? undefined,
      marketRegime: decisionLog?.marketState ? String((decisionLog.marketState as Record<string, unknown>).regime ?? "") : undefined,
      scores,
      metadata: { source: "paper-validation", simulationId: input.simulationId },
    });

    await createPaperExecution({
      campaignId: input.campaignId,
      executionKey: `${tradeKey}_exec_${input.simulationId}`,
      paperTradeId: trade.id,
      simulationId: input.simulationId,
      executionId: input.executionId,
      side: input.side,
      requestedQty: simulation?.requestedQty ?? input.executedQty,
      executedQty: input.executedQty,
      requestedPrice: simulation?.requestedPrice ?? input.avgFillPrice,
      avgFillPrice: input.avgFillPrice,
      spreadPct: simulation?.slippage?.spreadPct ?? undefined,
      slippagePct: simulation?.totalSlippagePct ?? 0,
      fee: input.fee,
      latencyMs: simulation?.executionDurationMs ?? simulation?.latency?.totalMs ?? undefined,
      fillCount: input.fillCount ?? simulation?.fillCount ?? 1,
      expectedFillPrice: accuracy.expectedFillPrice,
      fillAccuracyPct: accuracy.fillAccuracyPct,
      priceDifference: accuracy.priceDifference,
      latencyDifferenceMs: accuracy.latencyDifferenceMs,
      metadata: { quality: simulation?.quality, comparison: simulation?.comparison },
    });

    return { tradeId: trade.id, action: "OPEN" as const };
  }

  const openTrade = await prisma.paperTrade.findFirst({
    where: { userId: input.userId, symbol: input.symbol, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });

  if (!openTrade) return { skipped: true, reason: "no_open_trade" };

  const entryPrice = openTrade.avgEntryPrice ?? openTrade.entryPrice;
  const pnl = (input.avgFillPrice - entryPrice) * input.executedQty - input.fee - openTrade.fees;
  const returnPct = entryPrice > 0 ? ((input.avgFillPrice - entryPrice) / entryPrice) * 100 : 0;
  const holdSec = Math.floor((Date.now() - openTrade.openedAt.getTime()) / 1000);

  const closedTrade = await upsertPaperTrade({
    campaignId: input.campaignId ?? openTrade.campaignId ?? undefined,
    tradeKey: openTrade.tradeKey,
    userId: input.userId,
    symbol: input.symbol,
    side: "BUY",
    status: "CLOSED",
    entryPrice: openTrade.entryPrice,
    exitPrice: input.avgFillPrice,
    quantity: openTrade.quantity,
    avgEntryPrice: entryPrice,
    realizedPnl: pnl,
    returnPct,
    fees: openTrade.fees + input.fee,
    slippagePct: (openTrade.slippagePct + (simulation?.totalSlippagePct ?? 0)) / 2,
    holdSec,
    decisionId: openTrade.decisionId ?? undefined,
    executionId: input.executionId ?? openTrade.executionId ?? undefined,
    positionId: openTrade.positionId ?? undefined,
    simulationId: input.simulationId,
    scores: { ...scores, exitScore: scores.exitScore },
    closedAt: new Date(),
    metadata: { closeSimulationId: input.simulationId },
  });

  await createPaperExecution({
    campaignId: input.campaignId ?? openTrade.campaignId ?? undefined,
    executionKey: `${openTrade.tradeKey}_close_${input.simulationId}`,
    paperTradeId: closedTrade.id,
    simulationId: input.simulationId,
    executionId: input.executionId,
    side: "SELL",
    executedQty: input.executedQty,
    avgFillPrice: input.avgFillPrice,
    slippagePct: simulation?.totalSlippagePct ?? 0,
    fee: input.fee,
    fillCount: input.fillCount ?? 1,
    expectedFillPrice: accuracy.expectedFillPrice,
    fillAccuracyPct: accuracy.fillAccuracyPct,
    priceDifference: accuracy.priceDifference,
    latencyDifferenceMs: accuracy.latencyDifferenceMs,
  });

  return { tradeId: closedTrade.id, action: "CLOSE" as const, pnl, returnPct };
}

export async function recordPaperTradesFromPositions(input?: { userId?: string; limit?: number }) {
  const limit = input?.limit ?? 50;
  const positions = await prisma.position.findMany({
    where: {
      userId: input?.userId,
      status: "CLOSED",
    },
    orderBy: { closedAt: "desc" },
    take: limit,
    include: { tradingPair: true, profitLossRecords: true },
  });

  let recorded = 0;
  for (const pos of positions) {
    const meta = (pos.metadata as Record<string, unknown> | null) ?? {};
    if (String(meta.mode ?? "") !== "paper" && env.EXECUTION_MODE !== "paper") continue;

    const tradeKey = `paper_pos_${pos.id}`;
    const existing = await prisma.paperTrade.findUnique({ where: { tradeKey } });
    if (existing) continue;

    const pnl = pos.realizedPnl;
    const returnPct = pos.entryPrice > 0 ? ((Number(pos.closePrice ?? pos.markPrice ?? pos.entryPrice) - pos.entryPrice) / pos.entryPrice) * 100 : 0;
    const holdSec = pos.closedAt ? Math.floor((pos.closedAt.getTime() - pos.openedAt.getTime()) / 1000) : undefined;

    await upsertPaperTrade({
      tradeKey,
      userId: pos.userId,
      symbol: pos.tradingPair.symbol,
      side: "BUY",
      status: "CLOSED",
      entryPrice: pos.entryPrice,
      exitPrice: pos.closePrice ?? undefined,
      quantity: pos.quantity,
      avgEntryPrice: pos.entryPrice,
      realizedPnl: pnl,
      returnPct,
      fees: pos.feeTotal,
      holdSec,
      positionId: pos.id,
      openedAt: pos.openedAt,
      closedAt: pos.closedAt ?? undefined,
      metadata: { source: "position_backfill", mode: "paper" },
    });
    recorded++;
  }

  return { recorded, scanned: positions.length };
}

function computeTradeQualityScores(input: {
  simulation: {
    quality: { overallScore: number | null; slippageScore: number | null; fillScore: number | null; latencyScore: number | null } | null;
    totalSlippagePct: number | null;
  } | null;
  decisionLog: { confidence: number | null; scannerScore: number | null; riskScore: number | null } | null;
}): TradeQualityScores {
  const executionScore = input.simulation?.quality?.overallScore ?? 70;
  const entryScore = input.decisionLog?.scannerScore ?? input.decisionLog?.confidence ?? 65;
  const decisionScore = input.decisionLog?.confidence ?? 60;
  const riskScore = input.decisionLog?.riskScore != null ? Math.max(0, 100 - input.decisionLog.riskScore) : 70;
  const exitScore = input.simulation?.quality?.fillScore ?? 65;
  const slippagePenalty = Math.min(30, (input.simulation?.totalSlippagePct ?? 0) * 5);
  const tradeQualityScore = (entryScore + exitScore + executionScore) / 3 - slippagePenalty;
  const overallScore = (entryScore + exitScore + executionScore + decisionScore + riskScore) / 5;

  return {
    tradeQualityScore: Number(Math.max(0, Math.min(100, tradeQualityScore)).toFixed(2)),
    entryScore: Number(entryScore.toFixed(2)),
    exitScore: Number(exitScore.toFixed(2)),
    executionScore: Number(executionScore.toFixed(2)),
    decisionScore: Number(decisionScore.toFixed(2)),
    riskScore: Number(riskScore.toFixed(2)),
    overallScore: Number(Math.max(0, Math.min(100, overallScore)).toFixed(2)),
  };
}

function computeFillAccuracy(
  simulation: {
    requestedPrice: number | null;
    comparison: { requestedPrice: number | null; executedPrice: number | null; bestPossiblePrice: number | null } | null;
    slippage: { midPrice: number | null; spreadPct: number | null } | null;
    executionDurationMs: number | null;
    latency: { totalMs: number | null } | null;
  } | null,
  actualFillPrice: number,
) {
  const expectedFillPrice =
    simulation?.comparison?.bestPossiblePrice ??
    simulation?.slippage?.midPrice ??
    simulation?.requestedPrice ??
    actualFillPrice;
  const priceDifference = actualFillPrice - expectedFillPrice;
  const fillAccuracyPct =
    expectedFillPrice > 0 ? Math.max(0, 100 - Math.abs((priceDifference / expectedFillPrice) * 100)) : 100;
  const latencyMs = simulation?.executionDurationMs ?? simulation?.latency?.totalMs ?? 0;
  const latencyDifferenceMs = latencyMs > 0 ? latencyMs - 50 : 0;

  return {
    expectedFillPrice,
    fillAccuracyPct: Number(fillAccuracyPct.toFixed(3)),
    priceDifference: Number(priceDifference.toFixed(6)),
    latencyMs,
    latencyDifferenceMs,
  };
}
