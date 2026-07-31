import { prisma } from "@/src/server/db/prisma";
import type { OrchestrationEdgeHealthInput } from "@/src/server/orchestration/orchestration-types";

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function avg(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function drawdownAcceleration(returns: number[]) {
  let streak = 0;
  let worst = 0;
  for (const value of returns) {
    if (value < 0) streak += 1;
    else streak = 0;
    worst = Math.max(worst, streak);
  }
  return clamp(worst * 18);
}

function safeArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

export async function buildSelfPerformanceSnapshot(input: {
  userId?: string;
  strategy?: string;
  symbol?: string;
  marketRegime?: string;
  horizon?: string;
  rollingWindow?: number;
}): Promise<OrchestrationEdgeHealthInput> {
  const rollingWindow = Math.max(10, Math.min(200, input.rollingWindow ?? 50));
  const strategy = input.strategy || "UNKNOWN_STRATEGY";
  const where = {
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.symbol ? { symbol: input.symbol } : {}),
    ...(input.marketRegime ? { marketRegime: input.marketRegime } : {}),
    ...(input.strategy ? { strategy: input.strategy } : {}),
  };
  const trades = await prisma.learningTrade.findMany({
    where,
    orderBy: [{ closedAt: "desc" }, { createdAt: "desc" }],
    take: rollingWindow,
  });
  const aiMemoryRows = await prisma.aIAnalysisMemory.findMany({
    where: {
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.symbol ? { symbol: input.symbol } : {}),
      ...(input.marketRegime ? { marketRegime: input.marketRegime } : {}),
    },
    orderBy: { lastSeenAt: "desc" },
    take: Math.min(rollingWindow, 50),
  }).catch(() => []);

  const returns = trades.map((trade) => Number(trade.returnPercent ?? 0));
  const wins = trades.filter((trade) => trade.outcome === "WIN").length;
  const losses = trades.filter((trade) => trade.outcome === "LOSS").length;
  const rollingWinrate = trades.length ? (wins / trades.length) * 100 : 0;
  const rollingEv = avg(returns);
  const firstHalf = returns.slice(Math.floor(returns.length / 2));
  const secondHalf = returns.slice(0, Math.floor(returns.length / 2));
  const strategyDecayScore = clamp((avg(firstHalf) - avg(secondHalf)) * 18 + Math.max(0, losses - wins) * 5);
  const falsePositiveScore = clamp((losses / Math.max(1, trades.length)) * 100 - Math.max(0, rollingEv) * 4);
  const confidenceCalibrationError = avg(
    aiMemoryRows.map((row) => Math.abs(Number(row.avgConfidence ?? row.confidence ?? 0) - Number(row.winRate ?? 0))),
  );
  const manipulationExposure = clamp(
    trades.filter((trade) => {
      const tags = safeArray((trade.metadata as Record<string, unknown> | null)?.ruleTags);
      const deepTags = safeArray(((trade.metadata as Record<string, unknown> | null)?.deepAnalysis as Record<string, unknown> | undefined)?.learningTags);
      return [...tags, ...deepTags].some((tag) => tag.toLowerCase().includes("manipulation") || tag.toLowerCase().includes("fake"));
    }).length / Math.max(1, trades.length) * 100,
  );
  const volatilityExposure = clamp(
    avg(trades.map((trade) => Number(((trade.metadata as Record<string, unknown> | null)?.setupSnapshot as Record<string, unknown> | undefined)?.volatilityPercent ?? 0))) * 18,
  );
  const slippageDegradation = clamp(
    avg(trades.map((trade) => Math.max(0, Number(((trade.metadata as Record<string, unknown> | null)?.setupSnapshot as Record<string, unknown> | undefined)?.slippagePercent ?? 0)))) * 120,
  );
  const executionQualityDrift = clamp(
    100 -
      avg(
        trades.map((trade) =>
          Number(((trade.metadata as Record<string, unknown> | null)?.setupSnapshot as Record<string, unknown> | undefined)?.executionQualityScore ?? 72),
        ),
      ),
  );
  const edgeStabilityScore = clamp(
    55 +
      rollingWinrate * 0.25 +
      rollingEv * 7 -
      strategyDecayScore * 0.22 -
      falsePositiveScore * 0.16 -
      confidenceCalibrationError * 0.12 -
      drawdownAcceleration(returns) * 0.2,
  );

  return {
    userId: input.userId,
    strategy,
    symbol: input.symbol,
    marketRegime: input.marketRegime,
    horizon: input.horizon,
    rollingWindow,
    sampleCount: trades.length,
    rollingWinrate: Number(rollingWinrate.toFixed(2)),
    rollingEv: Number(rollingEv.toFixed(4)),
    regimeExpectancy: Number(rollingEv.toFixed(4)),
    strategyDecayScore: Number(strategyDecayScore.toFixed(2)),
    falsePositiveScore: Number(falsePositiveScore.toFixed(2)),
    drawdownAcceleration: Number(drawdownAcceleration(returns).toFixed(2)),
    confidenceCalibrationError: Number(confidenceCalibrationError.toFixed(2)),
    edgeStabilityScore: Number(edgeStabilityScore.toFixed(2)),
    manipulationExposure: Number(manipulationExposure.toFixed(2)),
    volatilityExposure: Number(volatilityExposure.toFixed(2)),
    slippageDegradation: Number(slippageDegradation.toFixed(2)),
    executionQualityDrift: Number(executionQualityDrift.toFixed(2)),
    diagnostics: {
      wins,
      losses,
      breakevens: Math.max(0, trades.length - wins - losses),
      avgReturn: rollingEv,
      recentReturns: returns.slice(0, 12),
      aiMemorySamples: aiMemoryRows.length,
    },
    recommendedActions:
      edgeStabilityScore < 38
        ? [
            {
              actionType: "THRESHOLD_INCREASE",
              scope: "strategy",
              targetKey: strategy,
              reason: "Strategy edge health is degraded",
              confidence: 78,
              thresholdDelta: 6,
              sizeMultiplier: 0.65,
              riskMultiplier: 0.72,
            },
          ]
        : [],
    metadata: {
      source: "self-performance-intelligence",
    },
  };
}
