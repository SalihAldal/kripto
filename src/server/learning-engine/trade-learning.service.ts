import { prisma } from "@/src/server/db/prisma";
import { persistTradeLearningMemory } from "@/src/server/learning-engine/learning-engine.repository";
import type { TradeLearningRecord } from "@/src/server/learning-engine/learning-engine.types";

export async function learnFromTrade(tradeId: string) {
  const trade = await prisma.learningTrade.findUnique({
    where: { id: tradeId },
    include: { features: true, marketEvidence: true },
  });
  if (!trade) return null;

  const featureMap = Object.fromEntries(
    trade.features.map((row) => [row.featureKey, row.numericValue ?? Number(row.featureValue ?? 0)]),
  );
  const meta = (trade.metadata as Record<string, unknown> | null) ?? {};

  const record: TradeLearningRecord = {
    tradeId: trade.id,
    symbol: trade.symbol,
    entryQuality: scoreFromMeta(meta, "entryQuality"),
    exitQuality: scoreFromMeta(meta, "exitQuality"),
    timingScore: scoreFromMeta(meta, "timingScore"),
    riskScore: scoreFromMeta(meta, "riskScore"),
    rewardScore: Number(trade.returnPercent ?? 0),
    executionScore: scoreFromMeta(meta, "executionScore"),
    regime: String(trade.marketRegime ?? meta.marketRegime ?? "UNKNOWN"),
    slippagePct: Number(meta.slippagePct ?? 0),
    features: featureMap,
  };

  await persistTradeLearningMemory({
    ...record,
    learningSummary: `${trade.outcome} ${trade.symbol} return=${trade.returnPercent ?? 0}% pattern=${trade.patternKey ?? "unknown"}`,
  });
  return record;
}

export async function learnFromRecentTrades(limit = 50) {
  const rows = await prisma.learningTrade.findMany({ orderBy: { closedAt: "desc" }, take: limit, select: { id: true } });
  let learned = 0;
  for (const row of rows) {
    await learnFromTrade(row.id).catch(() => null);
    learned += 1;
  }
  return { learned };
}

function scoreFromMeta(meta: Record<string, unknown>, key: string) {
  const value = Number(meta[key] ?? 0);
  return Number.isFinite(value) ? value : undefined;
}
