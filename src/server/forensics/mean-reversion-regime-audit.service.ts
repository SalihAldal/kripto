import { createHash } from "node:crypto";
import type {
  ExitForensicRecord,
  ForensicRegimeClass,
  MeanReversionEntryRecord,
  MeanReversionOfflineAnalysis,
  PnlLedgerEntry,
  StrategyPerformanceReport,
  StrategyPerformanceRow,
} from "@/src/server/forensics/forensic.types";

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function isMeanReversionStrategy(strategyId: string) {
  const normalized = strategyId.toUpperCase();
  return normalized.includes("MEAN_REVERSION") || normalized.includes("RANGE_MEAN");
}

export function buildMeanReversionEntryRecord(input: {
  candidateId: string;
  symbol: string;
  side: "LONG" | "SHORT";
  strategyId: string;
  strategySelectionReason: string;
  forensicRegime: ForensicRegimeClass;
  marketRegime: string;
  volatilityPercent: number;
  trendStrength: number;
  liquidityScore: number;
  momentumPercent: number;
  shortMomentumPercent: number;
  entryPrice: number;
  candidateTimestamp?: string;
  decisionTimestamp?: string;
  entryTimestamp?: string;
  tradeId?: string;
  metadata?: Record<string, unknown>;
}): MeanReversionEntryRecord {
  return {
    ...input,
    symbol: input.symbol.toUpperCase(),
    entryTimestamp: input.entryTimestamp ?? new Date().toISOString(),
  };
}

function volatilityBucket(volatilityPercent: number) {
  if (volatilityPercent < 0.8) return "low_lt_0.8";
  if (volatilityPercent < 1.5) return "mid_0.8_1.5";
  if (volatilityPercent < 2.5) return "high_1.5_2.5";
  return "extreme_gte_2.5";
}

function holdTimeBucket(durationMs: number) {
  if (durationMs < 60_000) return "lt_1m";
  if (durationMs < 300_000) return "1m_5m";
  if (durationMs < 900_000) return "5m_15m";
  if (durationMs < 3_600_000) return "15m_1h";
  return "gte_1h";
}

export function analyzeMeanReversionPerformance(input: {
  entries: MeanReversionEntryRecord[];
  pnlEntries: PnlLedgerEntry[];
  exitForensics?: Array<ExitForensicRecord & { tradeId?: string }>;
}): MeanReversionOfflineAnalysis {
  const pnlByTrade = new Map(input.pnlEntries.map((row) => [row.tradeId, row]));
  const exitByTrade = new Map((input.exitForensics ?? []).map((row) => [row.tradeId ?? "", row]));

  const byRegime: MeanReversionOfflineAnalysis["byRegime"] = {};
  const bySide: MeanReversionOfflineAnalysis["bySide"] = {};
  const byVolatilityBucket: MeanReversionOfflineAnalysis["byVolatilityBucket"] = {};
  const byHoldTimeBucket: MeanReversionOfflineAnalysis["byHoldTimeBucket"] = {};

  for (const entry of input.entries) {
    const pnl = entry.tradeId ? pnlByTrade.get(entry.tradeId) : undefined;
    const exit = entry.tradeId ? exitByTrade.get(entry.tradeId) : undefined;
    const netPnL = pnl?.netPnL ?? 0;
    const win = netPnL > 0;

    const bump = (map: Record<string, { tradeCount: number; wins: number; netPnL: number }>, key: string) => {
      const row = map[key] ?? { tradeCount: 0, wins: 0, netPnL: 0 };
      row.tradeCount += 1;
      if (win) row.wins += 1;
      row.netPnL = round(row.netPnL + netPnL, 4);
      map[key] = row;
    };

    bump(byRegime, entry.forensicRegime);
    bump(bySide, entry.side);
    bump(byVolatilityBucket, volatilityBucket(entry.volatilityPercent));
    bump(byHoldTimeBucket, holdTimeBucket(exit?.durationMs ?? 0));
  }

  const analysis: MeanReversionOfflineAnalysis = {
    generatedAt: new Date().toISOString(),
    totalTrades: input.entries.length,
    byRegime,
    bySide,
    byVolatilityBucket,
    byHoldTimeBucket,
    deterministicHash: "",
  };
  analysis.deterministicHash = deterministicHash({
    totalTrades: analysis.totalTrades,
    byRegime: analysis.byRegime,
    bySide: analysis.bySide,
    byVolatilityBucket: analysis.byVolatilityBucket,
    byHoldTimeBucket: analysis.byHoldTimeBucket,
  });
  return analysis;
}

export function buildStrategyPerformanceReport(input: {
  pnlEntries: PnlLedgerEntry[];
  strategyByTradeId: Record<string, string>;
  regimeByTradeId?: Record<string, ForensicRegimeClass>;
  exitForensicsByTradeId?: Record<string, ExitForensicRecord>;
}): StrategyPerformanceReport {
  const grouped = new Map<string, StrategyPerformanceRow>();

  for (const pnl of input.pnlEntries) {
    const strategy = input.strategyByTradeId[pnl.tradeId] ?? "UNKNOWN";
    const row =
      grouped.get(strategy) ??
      ({
        strategy,
        sampleSize: 0,
        tradeCount: 0,
        winRate: 0,
        grossPnL: 0,
        fees: 0,
        netPnL: 0,
        expectancy: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        averageWin: 0,
        averageLoss: 0,
        averageHoldingTimeMs: 0,
        medianHoldingTimeMs: 0,
        regimeBreakdown: {},
      } satisfies StrategyPerformanceRow);

    row.sampleSize += 1;
    row.tradeCount += 1;
    row.grossPnL = round(row.grossPnL + pnl.grossPnL, 4);
    row.fees = round(row.fees + pnl.totalFee, 4);
    row.netPnL = round(row.netPnL + pnl.netPnL, 4);

    const regime = input.regimeByTradeId?.[pnl.tradeId];
    if (regime) {
      const bucket = row.regimeBreakdown[regime] ?? { tradeCount: 0, netPnL: 0, winRate: 0 };
      bucket.tradeCount += 1;
      bucket.netPnL = round(bucket.netPnL + pnl.netPnL, 4);
      bucket.winRate = pnl.netPnL > 0 ? round((bucket.winRate * (bucket.tradeCount - 1) + 1) / bucket.tradeCount, 4) : round((bucket.winRate * (bucket.tradeCount - 1)) / bucket.tradeCount, 4);
      row.regimeBreakdown[regime] = bucket;
    }

    const exit = input.exitForensicsByTradeId?.[pnl.tradeId];
    if (exit?.durationMs) {
      row.averageHoldingTimeMs = round(
        (row.averageHoldingTimeMs * (row.tradeCount - 1) + exit.durationMs) / row.tradeCount,
        0,
      );
    }

    grouped.set(strategy, row);
  }

  const strategies = Array.from(grouped.values()).map((row) => {
    const strategyPnls = input.pnlEntries.filter(
      (pnl) => (input.strategyByTradeId[pnl.tradeId] ?? "UNKNOWN") === row.strategy,
    );
    const wins = strategyPnls.filter((pnl) => pnl.netPnL > 0);
    const losses = strategyPnls.filter((pnl) => pnl.netPnL < 0);
    const grossWins = wins.reduce((acc, row) => acc + row.netPnL, 0);
    const grossLosses = Math.abs(losses.reduce((acc, row) => acc + row.netPnL, 0));
    const holdTimes = strategyPnls
      .map((pnl) => input.exitForensicsByTradeId?.[pnl.tradeId]?.durationMs ?? 0)
      .filter((ms) => ms > 0)
      .sort((a, b) => a - b);
    const medianHoldingTimeMs =
      holdTimes.length > 0 ? holdTimes[Math.floor(holdTimes.length / 2)] ?? 0 : 0;
    let peak = 0;
    let equity = 0;
    let maxDrawdown = 0;
    for (const pnl of strategyPnls) {
      equity = round(equity + pnl.netPnL, 4);
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, round(peak - equity, 4));
    }
    return {
      ...row,
      winRate: row.tradeCount > 0 ? round(wins.length / row.tradeCount, 4) : 0,
      averageWin: wins.length > 0 ? round(grossWins / wins.length, 4) : 0,
      averageLoss: losses.length > 0 ? round(grossLosses / losses.length, 4) : 0,
      medianHoldingTimeMs,
      expectancy: row.tradeCount > 0 ? round(row.netPnL / row.tradeCount, 4) : 0,
      profitFactor: grossLosses > 0 ? round(grossWins / grossLosses, 4) : grossWins > 0 ? Number.POSITIVE_INFINITY : 0,
      maxDrawdown,
    };
  });

  const report: StrategyPerformanceReport = {
    generatedAt: new Date().toISOString(),
    totalSampleSize: input.pnlEntries.length,
    strategies: strategies.sort((a, b) => a.strategy.localeCompare(b.strategy)),
    deterministicHash: "",
  };
  report.deterministicHash = deterministicHash({
    totalSampleSize: report.totalSampleSize,
    strategies: report.strategies,
  });
  return report;
}

export function filterMeanReversionEntries(entries: MeanReversionEntryRecord[]) {
  return entries.filter((row) => isMeanReversionStrategy(row.strategyId));
}

export { isMeanReversionStrategy };
