import type { StrategyPerformanceReport } from "@/src/server/forensics/forensic.types";

export function buildTrendFollowingValidation(input: { strategyPerformance?: StrategyPerformanceReport }) {
  const trendRows = (input.strategyPerformance?.strategies ?? []).filter((row) => {
    const key = row.strategy.toUpperCase();
    return key.includes("TREND") || key.includes("MOMENTUM");
  });
  const tradeCount = trendRows.reduce((sum, row) => sum + row.tradeCount, 0);
  const netPnL = trendRows.reduce((sum, row) => sum + row.netPnL, 0);
  const expectancy = tradeCount > 0 ? netPnL / tradeCount : 0;
  return {
    generatedAt: new Date().toISOString(),
    strategyCount: trendRows.length,
    tradeCount,
    netPnL: Number(netPnL.toFixed(8)),
    expectancy: Number(expectancy.toFixed(8)),
    verdict: tradeCount < 10 ? "NOT_PROVEN" : netPnL > 0 ? "PROMISING" : "MIXED",
    reason:
      tradeCount < 10
        ? "Sample is too small for promotion/disable decisions."
        : "Trend rows are available for controlled evaluation.",
    rows: trendRows,
  };
}
