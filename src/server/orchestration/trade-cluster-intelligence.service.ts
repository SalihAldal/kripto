import { prisma } from "@/src/server/db/prisma";
import type { OrchestrationClusterInput } from "@/src/server/orchestration/orchestration-types";

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function sessionKey(date = new Date()) {
  const hour = date.getUTCHours();
  if (hour < 8) return "ASIA";
  if (hour < 16) return "EUROPE";
  return "US";
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function isManipulationTrade(metadata: Record<string, unknown>) {
  const text = JSON.stringify(metadata).toLowerCase();
  return text.includes("manipulation") || text.includes("fake_breakout") || text.includes("fake spike") || text.includes("trap");
}

export async function buildTradeClusterSnapshot(input: {
  userId?: string;
  symbol?: string;
  strategy?: string;
  marketRegime?: string;
  window?: number;
  now?: Date;
}): Promise<OrchestrationClusterInput> {
  const window = Math.max(8, Math.min(100, input.window ?? 35));
  const currentSession = sessionKey(input.now);
  const trades = await prisma.learningTrade.findMany({
    where: {
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.symbol ? { symbol: input.symbol } : {}),
      ...(input.strategy ? { strategy: input.strategy } : {}),
      ...(input.marketRegime ? { marketRegime: input.marketRegime } : {}),
    },
    orderBy: [{ closedAt: "desc" }, { createdAt: "desc" }],
    take: window,
  });

  let consecutiveLosses = 0;
  for (const trade of trades) {
    if (trade.outcome === "LOSS") consecutiveLosses += 1;
    else break;
  }
  const sameRegimeLosses = trades.filter((trade) => trade.outcome === "LOSS" && (!input.marketRegime || trade.marketRegime === input.marketRegime)).length;
  const manipulationLosses = trades.filter((trade) => trade.outcome === "LOSS" && isManipulationTrade(metadataObject(trade.metadata))).length;
  const volatilityClusterScore = clamp(
    trades.filter((trade) => {
      const setup = metadataObject(metadataObject(trade.metadata).setupSnapshot);
      return Number(setup.volatilityPercent ?? 0) >= 2.4;
    }).length / Math.max(1, trades.length) * 100,
  );
  const executionDegradationScore = clamp(
    trades.filter((trade) => {
      const setup = metadataObject(metadataObject(trade.metadata).setupSnapshot);
      return Number(setup.slippagePercent ?? 0) >= 0.22 || Number(setup.executionQualityScore ?? 100) <= 52;
    }).length / Math.max(1, trades.length) * 100,
  );
  const marketHostilityScore = clamp(
    consecutiveLosses * 16 +
      sameRegimeLosses * 5 +
      manipulationLosses * 8 +
      volatilityClusterScore * 0.2 +
      executionDegradationScore * 0.24,
  );
  const recommendedAction =
    marketHostilityScore >= 78
      ? "TEMPORARY_STRATEGY_DISABLE"
      : marketHostilityScore >= 62
        ? "COOLDOWN_MODE"
        : marketHostilityScore >= 45
          ? "ADAPTIVE_THRESHOLD_INCREASE"
          : "MONITOR";
  const cooldownUntil =
    marketHostilityScore >= 62 ? new Date(Date.now() + Math.min(6, Math.max(1, consecutiveLosses)) * 30 * 60_000).toISOString() : undefined;
  const clusterKey = [
    input.strategy ?? "ANY_STRATEGY",
    input.marketRegime ?? "ANY_REGIME",
    input.symbol ?? "ANY_SYMBOL",
    currentSession,
  ].join(":");

  return {
    clusterKey,
    clusterType: marketHostilityScore >= 62 ? "TEMPORARY_MARKET_HOSTILITY" : "ROLLING_TRADE_CLUSTER",
    symbol: input.symbol,
    strategy: input.strategy,
    marketRegime: input.marketRegime,
    sessionKey: currentSession,
    sampleCount: trades.length,
    consecutiveLosses,
    sameRegimeLosses,
    manipulationLosses,
    volatilityClusterScore: Number(volatilityClusterScore.toFixed(2)),
    executionDegradationScore: Number(executionDegradationScore.toFixed(2)),
    marketHostilityScore: Number(marketHostilityScore.toFixed(2)),
    recommendedAction,
    cooldownUntil,
    evidence: {
      recentTradeIds: trades.slice(0, 12).map((trade) => trade.tradeId),
      recentOutcomes: trades.slice(0, 12).map((trade) => trade.outcome),
    },
    metadata: {
      source: "trade-cluster-intelligence",
      window,
    },
  };
}
