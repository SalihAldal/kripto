import { prisma } from "@/src/server/db/prisma";
import { persistBenchmark } from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";
import { computePerformanceMetrics } from "@/src/server/quant-research/performance-metrics.service";
import type { MarketRegimeType, RegimeBenchmarkResult } from "@/src/server/quant-research/quant-research.types";

const REGIMES: MarketRegimeType[] = [
  "BULL",
  "BEAR",
  "RANGE",
  "PUMP",
  "DUMP",
  "HIGH_VOLATILITY",
  "LOW_VOLATILITY",
  "NEWS_RALLY",
  "MANIPULATION",
  "LIQUIDITY_CRISIS",
];

const REGIME_KEYWORDS: Record<MarketRegimeType, string[]> = {
  BULL: ["bull", "uptrend", "rising"],
  BEAR: ["bear", "downtrend", "falling"],
  RANGE: ["range", "sideways", "consolidation"],
  PUMP: ["pump", "surge", "spike"],
  DUMP: ["dump", "crash", "selloff"],
  HIGH_VOLATILITY: ["high_vol", "volatile", "high volatility"],
  LOW_VOLATILITY: ["low_vol", "quiet", "low volatility"],
  NEWS_RALLY: ["news", "sentiment", "rally"],
  MANIPULATION: ["manipulation", "spoof", "wash"],
  LIQUIDITY_CRISIS: ["liquidity", "crisis", "thin"],
};

export async function runRegimeBenchmark(input?: { genomeId?: string; windowDays?: number }) {
  return researchDbOnly(async () => {
    const since = new Date(Date.now() - (input?.windowDays ?? 180) * 24 * 60 * 60 * 1000);
    const trades = await prisma.learningTrade.findMany({
      where: { closedAt: { gte: since } },
      take: 3000,
      select: { returnPercent: true, marketRegime: true, metadata: true, outcome: true },
    });

    const results: RegimeBenchmarkResult[] = [];
    for (const regime of REGIMES) {
      const filtered = trades.filter((t) => classifyRegime(t) === regime);
      const returns = filtered.map((t) => Number(t.returnPercent ?? 0));
      const metrics = computePerformanceMetrics(returns);
      results.push({
        regime,
        tradeCount: metrics.tradeCount,
        winRate: metrics.winRate,
        profitFactor: metrics.profitFactor,
        expectancy: metrics.expectancy,
      });
      await persistBenchmark({
        benchmarkType: "CUSTOM",
        genomeId: input?.genomeId,
        windowDays: input?.windowDays,
        metrics: { regime, ...metrics },
        comparison: { regime },
      }).catch(() => null);
    }

    return { regimes: results.length, results };
  });
}

function classifyRegime(trade: { marketRegime?: string | null; metadata?: unknown }) {
  const text = `${trade.marketRegime ?? ""} ${JSON.stringify(trade.metadata ?? {})}`.toLowerCase();
  for (const [regime, keywords] of Object.entries(REGIME_KEYWORDS) as Array<[MarketRegimeType, string[]]>) {
    if (keywords.some((kw) => text.includes(kw))) return regime;
  }
  return "RANGE" as MarketRegimeType;
}
