import { prisma } from "@/src/server/db/prisma";
import { upsertMarketMemory, persistLearningInsight } from "@/src/server/learning-platform/learning-platform.repository";

const REGIME_MAP: Record<string, string[]> = {
  BULL: ["STRONG_BULL", "WEAK_BULL", "BREAKOUT", "ACCUMULATION"],
  BEAR: ["STRONG_BEAR", "WEAK_BEAR", "DISTRIBUTION", "DUMP"],
  RANGE: ["SIDEWAYS", "RANGE", "CONSOLIDATION"],
  PUMP: ["PUMP", "SURGE"],
  DUMP: ["DUMP", "CRASH"],
  HIGH_VOLATILITY: ["HIGH_VOLATILITY", "VOLATILE"],
  LOW_VOLATILITY: ["LOW_VOLATILITY", "QUIET"],
};

function classifyRegime(raw: string): string {
  const upper = raw.toUpperCase();
  for (const [bucket, keywords] of Object.entries(REGIME_MAP)) {
    if (keywords.some((k) => upper.includes(k))) return bucket;
  }
  return "RANGE";
}

export async function learnMarketMemory(limit = 500) {
  const evaluations = await prisma.decisionEvaluation.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      marketRegimeAfter: true,
      peakProfitPct: true,
      mfePct: true,
      volatilityChangePct: true,
    },
  });

  const trades = await prisma.learningTrade.findMany({
    orderBy: { closedAt: "desc" },
    take: limit,
    select: { returnPercent: true, outcome: true, marketRegime: true, metadata: true },
  });

  const buckets = new Map<string, { returns: number[]; wins: number; total: number; volatilities: number[] }>();

  for (const ev of evaluations) {
    const regime = classifyRegime(String(ev.marketRegimeAfter ?? "UNKNOWN"));
    const bucket = buckets.get(regime) ?? { returns: [], wins: 0, total: 0, volatilities: [] };
    const ret = Number(ev.peakProfitPct ?? ev.mfePct ?? 0);
    bucket.returns.push(ret);
    bucket.total += 1;
    if (ret > 0) bucket.wins += 1;
    if (ev.volatilityChangePct != null) bucket.volatilities.push(Number(ev.volatilityChangePct));
    buckets.set(regime, bucket);
  }

  for (const trade of trades) {
    const regime = classifyRegime(String(trade.marketRegime ?? (trade.metadata as Record<string, unknown> | null)?.marketRegime ?? "UNKNOWN"));
    const bucket = buckets.get(regime) ?? { returns: [], wins: 0, total: 0, volatilities: [] };
    const ret = Number(trade.returnPercent ?? 0);
    bucket.returns.push(ret);
    bucket.total += 1;
    if (trade.outcome === "WIN") bucket.wins += 1;
    buckets.set(regime, bucket);
  }

  const memories = [];
  for (const [regimeType, data] of buckets.entries()) {
    const avgReturn = data.returns.length > 0 ? data.returns.reduce((s, v) => s + v, 0) / data.returns.length : 0;
    const winRate = data.total > 0 ? (data.wins / data.total) * 100 : 0;
    const avgVolatility =
      data.volatilities.length > 0 ? data.volatilities.reduce((s, v) => s + v, 0) / data.volatilities.length : undefined;

    memories.push(
      await upsertMarketMemory({
        regimeType,
        occurrenceCount: data.total,
        avgReturnPct: Number(avgReturn.toFixed(4)),
        winRate: Number(winRate.toFixed(2)),
        avgVolatility: avgVolatility != null ? Number(avgVolatility.toFixed(4)) : undefined,
        similarityVector: {
          avgReturn,
          winRate,
          sampleSize: data.total,
        },
        metadata: { source: "learning-platform", updatedAt: new Date().toISOString() },
      }),
    );
  }

  if (memories.length > 0) {
    await persistLearningInsight({
      category: "MARKET",
      title: `Market memory refreshed (${memories.length} regimes)`,
      content: memories.map((m) => `${m.regimeType}: WR ${m.winRate?.toFixed(1)}% n=${m.occurrenceCount}`).join("; "),
    });
  }

  return { regimes: memories.length, memories };
}
