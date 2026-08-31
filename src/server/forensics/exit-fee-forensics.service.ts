import type { ExitReasonCode, PnlLedgerEntry } from "@/src/server/forensics/forensic.types";

function round(value: number, digits = 8) {
  return Number(value.toFixed(digits));
}

function holdBucket(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "UNKNOWN";
  if (durationMs < 60_000) return "LT_1M";
  if (durationMs < 300_000) return "1M_5M";
  if (durationMs < 900_000) return "5M_15M";
  if (durationMs < 3_600_000) return "15M_1H";
  return "GTE_1H";
}

export function buildExitForensicsReport(input: {
  pnlEntries: PnlLedgerEntry[];
}) {
  const exitReasonCounts: Record<string, number> = {};
  const exitModelCounts: Record<string, number> = {};
  const rows = input.pnlEntries.map((row) => {
    const exitReason = row.exitReason;
    const exitModel = row.exitModel;
    exitReasonCounts[String(exitReason ?? "UNKNOWN")] = (exitReasonCounts[String(exitReason ?? "UNKNOWN")] ?? 0) + 1;
    exitModelCounts[String(exitModel ?? "UNKNOWN")] = (exitModelCounts[String(exitModel ?? "UNKNOWN")] ?? 0) + 1;
    return {
      tradeId: row.tradeId,
      positionId: row.positionId ?? row.tradeId,
      symbol: row.symbol,
      entryPrice: Number(row.exitForensics?.entryPrice ?? 0),
      entryTimestamp: row.exitForensics?.entryTimestamp,
      exitPrice: Number(row.exitForensics?.exitPrice ?? 0),
      exitTimestamp: row.exitForensics?.exitTimestamp,
      holdDurationMs: Number(row.exitForensics?.holdDurationMs ?? row.exitForensics?.durationMs ?? 0),
      exitReason,
      exitModel,
      tpLevel: row.exitForensics?.tpLevel ?? null,
      slLevel: row.exitForensics?.slLevel ?? null,
      strategyExitReason: row.exitForensics?.strategyExitReason ?? null,
      timeExitReason: row.exitForensics?.timeExitReason ?? null,
      grossPnL: row.grossPnL,
      entryFee: row.entryFee,
      exitFee: row.exitFee,
      totalFee: row.totalFee,
      netPnL: row.netPnL,
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    precedence: {
      positionMonitor:
        "EXIT_AI -> PAPER_PROTECTIONS -> SMART_EXIT -> TP/SL -> DYNAMIC_EXIT -> TRAILING/EARLY_PROTECT -> TIMEOUT",
      replayWindow: "SAME_CANDLE: STOP_LOSS (default), then STOP_LOSS, then TAKE_PROFIT, then TIME_EXIT/END_OF_REPLAY",
    },
    exitPrecedence: {
      positionMonitor:
        "EXIT_AI -> PAPER_PROTECTIONS -> SMART_EXIT -> TP/SL -> DYNAMIC_EXIT -> TRAILING/EARLY_PROTECT -> TIMEOUT",
      replayWindow: "SAME_CANDLE: STOP_LOSS (default), then STOP_LOSS, then TAKE_PROFIT, then TIME_EXIT/END_OF_REPLAY",
    },
    rows,
    exitReasonCounts,
    exitModelCounts,
  };
}

export function buildReplayExitDiagnostics(input: {
  pnlEntries: PnlLedgerEntry[];
}) {
  const boolToTri = (value: boolean): "TRUE" | "FALSE" => (value ? "TRUE" : "FALSE");
  return {
    generatedAt: new Date().toISOString(),
    rows: input.pnlEntries.map((row) => {
      const exit = row.exitForensics;
      const isReplay = row.exitModel === "REPLAY_WINDOW";
      const isEndOfReplay = row.exitReason === "END_OF_REPLAY";
      const tpHit = isReplay && row.exitReason === "TAKE_PROFIT";
      const slHit = isReplay && row.exitReason === "STOP_LOSS";
      const strategyHit = isReplay && row.exitReason === "STRATEGY_EXIT";
      const timeHit = isReplay && row.exitReason === "TIME_EXIT";
      return {
        tradeId: row.tradeId,
        positionId: row.positionId ?? row.tradeId,
        symbol: row.symbol,
        exitReason: row.exitReason,
        exitModel: row.exitModel,
        replayWindowEnded: exit?.replayWindowEnded,
        tpWouldHitBeforeBoundary: isEndOfReplay ? "UNKNOWN" : boolToTri(tpHit),
        slWouldHitBeforeBoundary: isEndOfReplay ? "UNKNOWN" : boolToTri(slHit),
        strategyExitWouldHitBeforeBoundary: isEndOfReplay ? "UNKNOWN" : boolToTri(strategyHit),
        timeExitWouldHitBeforeBoundary: isEndOfReplay ? "UNKNOWN" : boolToTri(timeHit),
        positionMonitorActive: row.exitModel === "POSITION_MONITOR" ? "TRUE" : isReplay ? "FALSE" : "UNKNOWN",
        hadPreviousExitCandidate:
          typeof exit?.strategyExit === "boolean" ? boolToTri(Boolean(exit.strategyExit)) : "UNKNOWN",
        diagnostic:
          isReplay && isEndOfReplay
            ? "Stored replay data is insufficient to deterministically infer TP/SL/strategy conditions before boundary."
            : "Deterministic from recorded exit reason.",
      };
    }),
  };
}

export function buildGrossPositiveNetNegative(input: {
  pnlEntries: PnlLedgerEntry[];
  strategyByTradeId: Record<string, string>;
}) {
  return input.pnlEntries
    .filter((row) => row.grossPnL > 0 && row.netPnL < 0)
    .map((row) => ({
      tradeId: row.tradeId,
      symbol: row.symbol,
      strategy: input.strategyByTradeId[row.tradeId] ?? "UNKNOWN",
      grossPnL: row.grossPnL,
      entryFee: row.entryFee,
      exitFee: row.exitFee,
      totalFee: row.totalFee,
      netPnL: row.netPnL,
      feeToGrossRatio: row.feeToGrossRatio,
      minimumGrossMovementToCoverFees: round(Math.max(0, row.totalFee)),
    }));
}

export function buildFeeByStrategy(input: {
  pnlEntries: PnlLedgerEntry[];
  strategyByTradeId: Record<string, string>;
}) {
  const map = new Map<
    string,
    { strategy: string; grossPnL: number; fees: number; netPnL: number; tradeCount: number; grossPositiveNetNegativeCount: number }
  >();
  for (const row of input.pnlEntries) {
    const strategy = input.strategyByTradeId[row.tradeId] ?? "UNKNOWN";
    const current =
      map.get(strategy) ?? { strategy, grossPnL: 0, fees: 0, netPnL: 0, tradeCount: 0, grossPositiveNetNegativeCount: 0 };
    current.grossPnL = round(current.grossPnL + row.grossPnL);
    current.fees = round(current.fees + row.totalFee);
    current.netPnL = round(current.netPnL + row.netPnL);
    current.tradeCount += 1;
    if (row.grossPnL > 0 && row.netPnL < 0) current.grossPositiveNetNegativeCount += 1;
    map.set(strategy, current);
  }
  return Array.from(map.values()).map((row) => ({
    ...row,
    feePerTrade: row.tradeCount > 0 ? round(row.fees / row.tradeCount) : 0,
  }));
}

export function buildFeeByHoldTime(input: {
  pnlEntries: PnlLedgerEntry[];
}) {
  const map = new Map<string, { holdBucket: string; tradeCount: number; grossPnL: number; fees: number; netPnL: number }>();
  for (const row of input.pnlEntries) {
    const bucket = holdBucket(Number(row.exitForensics?.holdDurationMs ?? row.exitForensics?.durationMs ?? 0));
    const current = map.get(bucket) ?? { holdBucket: bucket, tradeCount: 0, grossPnL: 0, fees: 0, netPnL: 0 };
    current.tradeCount += 1;
    current.grossPnL = round(current.grossPnL + row.grossPnL);
    current.fees = round(current.fees + row.totalFee);
    current.netPnL = round(current.netPnL + row.netPnL);
    map.set(bucket, current);
  }
  return Array.from(map.values()).map((row) => ({
    ...row,
    avgFeePerTrade: row.tradeCount > 0 ? round(row.fees / row.tradeCount) : 0,
  }));
}

export function buildExitFeeInteraction(input: {
  pnlEntries: PnlLedgerEntry[];
}) {
  const classify = (row: PnlLedgerEntry): "EXIT_CREATED_LOSS" | "FEE_CREATED_LOSS" | "BOTH" | "UNKNOWN" => {
    if (row.grossPnL > 0 && row.netPnL < 0) return "FEE_CREATED_LOSS";
    if (row.grossPnL < 0 && row.netPnL < 0 && row.totalFee > Math.abs(row.grossPnL)) return "BOTH";
    if (row.grossPnL < 0 && row.netPnL < 0) return "EXIT_CREATED_LOSS";
    return "UNKNOWN";
  };
  return input.pnlEntries.map((row) => ({
    tradeId: row.tradeId,
    symbol: row.symbol,
    classification: classify(row),
    grossPnL: row.grossPnL,
    totalFee: row.totalFee,
    netPnL: row.netPnL,
    exitReason: row.exitReason as ExitReasonCode | undefined,
  }));
}
