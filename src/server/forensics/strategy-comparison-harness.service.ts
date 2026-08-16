import { createHash } from "node:crypto";
import type {
  EntryTimingRecord,
  FeeEdgeMetricsSnapshot,
  ForensicRegimeClass,
  PnlLedgerEntry,
  StrategyComparisonConfig,
  StrategyComparisonMetrics,
  StrategyComparisonPolicyFlags,
  StrategyComparisonReport,
  TdiDecisionRecord,
} from "@/src/server/forensics/forensic.types";
import { classifyForensicRegime } from "@/src/server/forensics/regime-classifier.service";
import { classifyEntryTiming } from "@/src/server/forensics/entry-timing-forensics.service";

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

export type StrategyComparisonInputRow = {
  tradeId: string;
  symbol: string;
  strategy: string;
  regime: string;
  netPnL: number;
  grossPnL: number;
  totalFee: number;
  tdi?: TdiDecisionRecord;
  feeMetrics?: FeeEdgeMetricsSnapshot;
  entryTiming?: EntryTimingRecord;
};

export function buildStrategyComparisonInputRows(input: {
  pnlEntries: PnlLedgerEntry[];
  strategyByTradeId?: Record<string, string>;
  regimeByTradeId?: Record<string, ForensicRegimeClass | string>;
  tdiBySymbol?: Record<string, TdiDecisionRecord>;
  feeMetricsBySymbol?: Record<string, FeeEdgeMetricsSnapshot>;
  entryTimingBySymbol?: Record<string, EntryTimingRecord>;
}): StrategyComparisonInputRow[] {
  return input.pnlEntries.map((row) => ({
    tradeId: row.tradeId,
    symbol: row.symbol,
    strategy: input.strategyByTradeId?.[row.tradeId] ?? "UNKNOWN",
    regime: String(input.regimeByTradeId?.[row.tradeId] ?? "UNKNOWN"),
    netPnL: row.netPnL,
    grossPnL: row.grossPnL,
    totalFee: row.totalFee,
    tdi: input.tdiBySymbol?.[row.symbol.toUpperCase()],
    feeMetrics: input.feeMetricsBySymbol?.[row.symbol.toUpperCase()],
    entryTiming: input.entryTimingBySymbol?.[row.symbol.toUpperCase()],
  }));
}

function passesPolicy(row: StrategyComparisonInputRow, flags: StrategyComparisonPolicyFlags) {
  if (flags.regimeGating) {
    const forensicRegime = classifyForensicRegime({
      marketRegime: row.regime,
      volatilityPercent: 0,
    });
    if (forensicRegime === "CHAOS" || forensicRegime === "HIGH_VOLATILITY") return false;
  }
  if (flags.feeFloor && row.feeMetrics) {
    if (row.feeMetrics.expectedGrossToFeeRatio < 1) return false;
  }
  if (flags.entryTimingProtection && row.entryTiming) {
    if (row.entryTiming.classification === "POSSIBLY_LATE") return false;
  }
  return true;
}

export function computeStrategyComparisonMetrics(rows: StrategyComparisonInputRow[]): StrategyComparisonMetrics {
  const sampleSize = rows.length;
  const wins = rows.filter((row) => row.netPnL > 0);
  const losses = rows.filter((row) => row.netPnL < 0);
  const grossWins = wins.reduce((acc, row) => acc + row.netPnL, 0);
  const grossLosses = Math.abs(losses.reduce((acc, row) => acc + row.netPnL, 0));
  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const row of rows) {
    equity = round(equity + row.netPnL, 4);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, round(peak - equity, 4));
  }
  const grossPnL = round(rows.reduce((acc, row) => acc + row.grossPnL, 0), 4);
  const fees = round(rows.reduce((acc, row) => acc + row.totalFee, 0), 4);
  const netPnL = round(rows.reduce((acc, row) => acc + row.netPnL, 0), 4);
  return {
    sampleSize,
    tradeCount: sampleSize,
    winRate: sampleSize > 0 ? round(wins.length / sampleSize, 4) : 0,
    grossPnL,
    fees,
    netPnL,
    expectancy: sampleSize > 0 ? round(netPnL / sampleSize, 4) : 0,
    profitFactor: grossLosses > 0 ? round(grossWins / grossLosses, 4) : grossWins > 0 ? Number.POSITIVE_INFINITY : 0,
    maxDrawdown,
    feeDragRatio: Math.abs(grossPnL) > 0 ? round(fees / Math.abs(grossPnL), 4) : fees > 0 ? Number.POSITIVE_INFINITY : 0,
  };
}

export function compareStrategyConfigurations(input: {
  rows: StrategyComparisonInputRow[];
  baseline: StrategyComparisonConfig;
  candidate: StrategyComparisonConfig;
  evidenceRefs?: string[];
}): StrategyComparisonReport {
  const baselineRows = input.rows.filter((row) => passesPolicy(row, input.baseline.policyFlags));
  const candidateRows = input.rows.filter((row) => passesPolicy(row, input.candidate.policyFlags));
  const baselineMetrics = computeStrategyComparisonMetrics(baselineRows);
  const candidateMetrics = computeStrategyComparisonMetrics(candidateRows);
  const delta: Partial<StrategyComparisonMetrics> = {
    sampleSize: candidateMetrics.sampleSize - baselineMetrics.sampleSize,
    winRate: round(candidateMetrics.winRate - baselineMetrics.winRate, 4),
    netPnL: round(candidateMetrics.netPnL - baselineMetrics.netPnL, 4),
    expectancy: round(candidateMetrics.expectancy - baselineMetrics.expectancy, 4),
    maxDrawdown: round(candidateMetrics.maxDrawdown - baselineMetrics.maxDrawdown, 4),
    feeDragRatio: round(candidateMetrics.feeDragRatio - baselineMetrics.feeDragRatio, 4),
  };
  const report: StrategyComparisonReport = {
    generatedAt: new Date().toISOString(),
    baseline: { ...input.baseline, metrics: baselineMetrics },
    candidate: { ...input.candidate, metrics: candidateMetrics },
    delta,
    evidenceRefs: input.evidenceRefs ?? ["P0/P1 forensic artifacts"],
    deterministicHash: "",
    promotionReady: false,
  };
  report.deterministicHash = deterministicHash({
    baseline: report.baseline,
    candidate: report.candidate,
    delta: report.delta,
  });
  return report;
}

export function filterRowsWithoutLookAhead(rows: StrategyComparisonInputRow[]) {
  return rows.filter((row) => {
    if (!row.entryTiming) return true;
    return row.entryTiming.classification !== "UNKNOWN";
  });
}

export { classifyEntryTiming };
