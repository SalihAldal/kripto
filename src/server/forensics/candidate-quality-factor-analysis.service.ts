import type {
  EntryTimingRecord,
  FeeEdgeMetricsSnapshot,
  TdiDecisionRecord,
} from "@/src/server/forensics/forensic.types";
import type { StrategyComparisonInputRow } from "@/src/server/forensics/strategy-comparison-harness.service";

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function mean(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildCandidateQualityFactorAnalysis(input: {
  rows: StrategyComparisonInputRow[];
  tdiBySymbol: Record<string, TdiDecisionRecord>;
  entryTimingBySymbol: Record<string, EntryTimingRecord>;
  feeMetricsBySymbol: Record<string, FeeEdgeMetricsSnapshot>;
}) {
  const winners = input.rows.filter((row) => row.netPnL > 0);
  const losers = input.rows.filter((row) => row.netPnL < 0);
  const makeStats = (rows: StrategyComparisonInputRow[]) => ({
    sampleSize: rows.length,
    avgNetPnL: round(mean(rows.map((row) => row.netPnL)), 8),
    avgGrossPnL: round(mean(rows.map((row) => row.grossPnL)), 8),
    avgFee: round(mean(rows.map((row) => row.totalFee)), 8),
    avgFeeToGrossRatio: round(
      mean(
        rows.map((row) => {
          const gross = Math.abs(row.grossPnL);
          return gross > 0 ? row.totalFee / gross : 0;
        }),
      ),
    ),
    avgEntryDelayMs: round(
      mean(
        rows.map((row) => Number(input.entryTimingBySymbol[row.symbol]?.entryDelayMs ?? 0)),
      ),
      2,
    ),
    avgMovementToEntryPercent: round(
      mean(
        rows.map((row) => Number(input.entryTimingBySymbol[row.symbol]?.movementToEntryPercent ?? 0)),
      ),
      6,
    ),
    avgTdiScore: round(
      mean(
        rows.map((row) =>
          Number(
            input.tdiBySymbol[row.symbol]?.hybridCompositeScore ??
              input.tdiBySymbol[row.symbol]?.masterExpertConsensusScore ??
              input.tdiBySymbol[row.symbol]?.consensusScore ??
              0,
          ),
        ),
      ),
      4,
    ),
    avgExpectedGrossToFeeRatio: round(
      mean(
        rows.map((row) => Number(input.feeMetricsBySymbol[row.symbol]?.expectedGrossToFeeRatio ?? 0)),
      ),
      4,
    ),
  });

  const winnerStats = makeStats(winners);
  const loserStats = makeStats(losers);
  const classification = classifyEvidence(winnerStats.sampleSize, loserStats.sampleSize);

  return {
    generatedAt: new Date().toISOString(),
    winners: winnerStats,
    losers: loserStats,
    deltas: {
      netPnL: round(winnerStats.avgNetPnL - loserStats.avgNetPnL, 8),
      feeToGrossRatio: round(winnerStats.avgFeeToGrossRatio - loserStats.avgFeeToGrossRatio, 6),
      entryDelayMs: round(winnerStats.avgEntryDelayMs - loserStats.avgEntryDelayMs, 2),
      expectedGrossToFeeRatio: round(
        winnerStats.avgExpectedGrossToFeeRatio - loserStats.avgExpectedGrossToFeeRatio,
        4,
      ),
    },
    evidenceClass: classification,
  };
}

function classifyEvidence(winnerSample: number, loserSample: number): "FACT" | "REPEATED_PATTERN" | "HYPOTHESIS" {
  const minSample = Math.min(winnerSample, loserSample);
  if (minSample >= 20) return "FACT";
  if (minSample >= 8) return "REPEATED_PATTERN";
  return "HYPOTHESIS";
}
