import type { StrategyComparisonInputRow } from "@/src/server/forensics/strategy-comparison-harness.service";

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

export function buildProfitConcentrationReport(input: { rows: StrategyComparisonInputRow[] }) {
  const positive = input.rows.filter((row) => row.netPnL > 0);
  if (positive.length === 0) {
    return {
      available: false,
      reason: "No positive trades in sample",
      top1TradeContributionPct: 0,
      top3TradeContributionPct: 0,
      topSymbolContributionPct: 0,
      topStrategyContributionPct: 0,
      topRegimeContributionPct: 0,
      concentrationClass: "UNKNOWN" as const,
    };
  }
  const total = positive.reduce((sum, row) => sum + row.netPnL, 0);
  const sortedTrades = [...positive].sort((a, b) => b.netPnL - a.netPnL);
  const top1TradeContributionPct = (sortedTrades[0]?.netPnL ?? 0) / total;
  const top3TradeContributionPct =
    sortedTrades.slice(0, 3).reduce((sum, row) => sum + row.netPnL, 0) / total;

  const bySymbol = aggregateShare(positive, (row) => row.symbol);
  const byStrategy = aggregateShare(positive, (row) => row.strategy);
  const byRegime = aggregateShare(positive, (row) => row.regime);

  const topSymbol = bySymbol[0];
  const topStrategy = byStrategy[0];
  const topRegime = byRegime[0];

  const topSymbolContributionPct = topSymbol?.share ?? 0;
  const topStrategyContributionPct = topStrategy?.share ?? 0;
  const topRegimeContributionPct = topRegime?.share ?? 0;
  const concentrationClass =
    top1TradeContributionPct > 0.55 || topSymbolContributionPct > 0.7
      ? "SINGLE_TRADE_LUCK"
      : "REAL_EDGE";

  return {
    available: true,
    totalPositiveTrades: positive.length,
    totalPositiveNetPnL: round(total, 8),
    top1TradeContributionPct: round(top1TradeContributionPct, 6),
    top3TradeContributionPct: round(top3TradeContributionPct, 6),
    topSymbol: topSymbol?.key ?? null,
    topSymbolContributionPct: round(topSymbolContributionPct, 6),
    topStrategy: topStrategy?.key ?? null,
    topStrategyContributionPct: round(topStrategyContributionPct, 6),
    topRegime: topRegime?.key ?? null,
    topRegimeContributionPct: round(topRegimeContributionPct, 6),
    concentrationClass,
  };
}

function aggregateShare(rows: StrategyComparisonInputRow[], getKey: (row: StrategyComparisonInputRow) => string) {
  const map = new Map<string, number>();
  const total = rows.reduce((sum, row) => sum + row.netPnL, 0);
  for (const row of rows) {
    const key = getKey(row);
    map.set(key, (map.get(key) ?? 0) + row.netPnL);
  }
  return Array.from(map.entries())
    .map(([key, value]) => ({ key, value, share: total > 0 ? value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}
