import { createHash } from "node:crypto";
import type {
  StrategyPerformanceRow,
  VolatilityBreakoutBreakdownRow,
  VolatilityBreakoutValidationReport,
} from "@/src/server/forensics/forensic.types";

const MIN_SAMPLE = 20;

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function isVolatilityBreakoutStrategy(strategy: string) {
  const normalized = strategy.toUpperCase();
  return (
    normalized.includes("BREAKOUT") ||
    normalized.includes("MOMENTUM") ||
    normalized.includes("VOLATILITY")
  );
}

export function buildVolatilityBreakoutValidationReport(input: {
  strategies: StrategyPerformanceRow[];
  minimumSampleRequired?: number;
  regimeMatrix?: import("@/src/server/forensics/forensic.types").StrategyRegimeMatrixReport;
}): VolatilityBreakoutValidationReport & { breakdown?: VolatilityBreakoutBreakdownRow[]; peerComparison?: string } {
  const minimumSampleRequired = input.minimumSampleRequired ?? MIN_SAMPLE;
  const rows = input.strategies.filter((row) => isVolatilityBreakoutStrategy(row.strategy));
  const aggregate = rows.reduce(
    (acc, row) => {
      acc.sampleSize += row.sampleSize;
      acc.tradeCount += row.tradeCount;
      acc.netPnL += row.netPnL;
      acc.wins += row.winRate * row.tradeCount;
      return acc;
    },
    { sampleSize: 0, tradeCount: 0, netPnL: 0, wins: 0 },
  );
  const winRate = aggregate.tradeCount > 0 ? Number((aggregate.wins / aggregate.tradeCount).toFixed(4)) : 0;
  const sufficientData = aggregate.sampleSize >= minimumSampleRequired;
  const expectancy =
    aggregate.tradeCount > 0 ? Number((aggregate.netPnL / aggregate.tradeCount).toFixed(4)) : 0;
  const report: VolatilityBreakoutValidationReport = {
    generatedAt: new Date().toISOString(),
    strategy: "VOLATILITY_BREAKOUT_FAMILY",
    sampleSize: aggregate.sampleSize,
    tradeCount: aggregate.tradeCount,
    winRate,
    netPnL: Number(aggregate.netPnL.toFixed(4)),
    expectancy,
    profitFactor: rows[0]?.profitFactor ?? 0,
    maxDrawdown: Math.max(...rows.map((row) => row.maxDrawdown), 0),
    sufficientData,
    minimumSampleRequired,
    recommendation: sufficientData
      ? aggregate.netPnL > 0 && winRate >= 0.5
        ? "FAVOR_MORE_RESEARCH"
        : "NEUTRAL"
      : "INSUFFICIENT_DATA",
    reasonDetail: sufficientData
      ? `Historical sample n=${aggregate.sampleSize}; do not promote from small samples`
      : `Only n=${aggregate.sampleSize} available; need n>=${minimumSampleRequired} before slot-allocation recommendation`,
    deterministicHash: "",
  };
  report.deterministicHash = deterministicHash({
    sampleSize: report.sampleSize,
    netPnL: report.netPnL,
    winRate: report.winRate,
    recommendation: report.recommendation,
  });

  const breakdown: VolatilityBreakoutBreakdownRow[] = [];
  if (input.regimeMatrix) {
    for (const cell of input.regimeMatrix.cells) {
      if (!isVolatilityBreakoutStrategy(cell.strategy)) continue;
      breakdown.push({
        dimension: "regime",
        bucket: cell.regime,
        tradeCount: cell.tradeCount,
        winRate: cell.winRate,
        netPnL: cell.netPnL,
        expectancy: cell.expectancy,
        sampleLabel: cell.sampleLabel,
      });
    }
  }

  const peerComparison =
    aggregate.sampleSize < minimumSampleRequired
      ? `n=${aggregate.sampleSize} insufficient; do not compare raw totals to other strategies`
      : "Compare within same regime cells only; raw totals misleading";

  return { ...report, breakdown, peerComparison };
}
