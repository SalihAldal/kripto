import { createHash } from "node:crypto";
import type {
  EntryTimingRecord,
  ForensicRegimeClass,
  LossPatternCode,
  PnlLedgerEntry,
  TradePatternClassification,
  TradePatternReport,
  WinPatternConfidence,
} from "@/src/server/forensics/forensic.types";

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

export function classifyLossPattern(input: {
  tradeId: string;
  symbol: string;
  strategy: string;
  regime: string;
  netPnL: number;
  grossPnL: number;
  totalFee: number;
  exitReason?: string;
  entryTiming?: EntryTimingRecord;
  forensicRegime?: ForensicRegimeClass;
}): TradePatternClassification {
  const evidence: string[] = [];
  let classification: LossPatternCode = "UNKNOWN";

  if (input.netPnL >= 0) {
    return {
      tradeId: input.tradeId,
      symbol: input.symbol,
      strategy: input.strategy,
      regime: input.regime,
      classification: "UNKNOWN",
      evidence: ["Not a losing trade"],
      netPnL: input.netPnL,
    };
  }

  const feeRatio = Math.abs(input.grossPnL) > 0 ? input.totalFee / Math.abs(input.grossPnL) : Number.POSITIVE_INFINITY;
  if (feeRatio >= 1) {
    classification = "FEE_DRAG";
    evidence.push(`fees=${input.totalFee} gross=${input.grossPnL} ratio=${feeRatio.toFixed(4)}`);
  }

  if (
    input.entryTiming?.classification === "POSSIBLY_LATE" ||
    input.entryTiming?.classification === "CHASING" ||
    input.entryTiming?.classification === "EDGE_DECAY"
  ) {
    classification = "ENTRY_TIMING";
    evidence.push(`entryDelayMs=${input.entryTiming.entryDelayMs} classification=${input.entryTiming.classification}`);
  }

  if (
    input.forensicRegime &&
    (input.forensicRegime === "CHAOS" ||
      input.forensicRegime === "HIGH_VOLATILITY" ||
      (input.strategy.toUpperCase().includes("MEAN_REVERSION") && input.forensicRegime === "TREND"))
  ) {
    classification = "REGIME_MISMATCH";
    evidence.push(`strategy=${input.strategy} forensicRegime=${input.forensicRegime}`);
  }

  if (input.exitReason === "END_OF_REPLAY") {
    classification = classification === "UNKNOWN" ? "EXIT_PROBLEM" : classification;
    evidence.push("exitReason=END_OF_REPLAY");
  }

  if (classification === "UNKNOWN" && Math.abs(input.netPnL) < input.totalFee * 2) {
    classification = "NORMAL_VARIANCE";
    evidence.push("Small loss within fee-adjusted noise band");
  }

  if (classification === "UNKNOWN") {
    classification = "STRATEGY_WEAKNESS";
    evidence.push("No stronger evidence category matched");
  }

  return {
    tradeId: input.tradeId,
    symbol: input.symbol,
    strategy: input.strategy,
    regime: input.regime,
    classification,
    evidence,
    netPnL: input.netPnL,
  };
}

export function classifyWinningPattern(input: {
  tradeId: string;
  symbol: string;
  strategy: string;
  regime: string;
  netPnL: number;
  sampleSize: number;
  entryTiming?: EntryTimingRecord;
  exitReason?: string;
}): TradePatternClassification {
  const evidence: string[] = [];
  let classification: WinPatternConfidence = "HYPOTHESIS";

  if (input.netPnL <= 0) {
    return {
      tradeId: input.tradeId,
      symbol: input.symbol,
      strategy: input.strategy,
      regime: input.regime,
      classification: "HYPOTHESIS",
      evidence: ["Not a winning trade"],
      netPnL: input.netPnL,
    };
  }

  if (input.entryTiming?.classification === "GOOD_ENTRY") {
    evidence.push("entryTiming=GOOD_ENTRY");
  }
  if (input.exitReason === "TAKE_PROFIT") {
    evidence.push("exitReason=TAKE_PROFIT");
  }
  if (input.strategy.toUpperCase().includes("BREAKOUT") || input.strategy.toUpperCase().includes("VOLATILITY")) {
    evidence.push(`strategy=${input.strategy}`);
  }

  if (input.sampleSize >= 20 && evidence.length >= 2) {
    classification = "REPEATED_PATTERN";
  } else if (input.sampleSize >= 5 && evidence.length >= 1) {
    classification = "FACT";
  } else {
    classification = "HYPOTHESIS";
    evidence.push(`sampleSize=${input.sampleSize} below n=20 threshold`);
  }

  return {
    tradeId: input.tradeId,
    symbol: input.symbol,
    strategy: input.strategy,
    regime: input.regime,
    classification,
    evidence,
    netPnL: input.netPnL,
  };
}

export function buildLossPatternReport(input: {
  pnlEntries: PnlLedgerEntry[];
  strategyByTradeId: Record<string, string>;
  regimeByTradeId: Record<string, ForensicRegimeClass | string>;
  entryTimingBySymbol?: Record<string, EntryTimingRecord>;
}): TradePatternReport {
  const losses = input.pnlEntries.filter((row) => row.netPnL < 0);
  const classifications = losses.map((pnl) =>
    classifyLossPattern({
      tradeId: pnl.tradeId,
      symbol: pnl.symbol,
      strategy: input.strategyByTradeId[pnl.tradeId] ?? "UNKNOWN",
      regime: String(input.regimeByTradeId[pnl.tradeId] ?? "UNKNOWN"),
      netPnL: pnl.netPnL,
      grossPnL: pnl.grossPnL,
      totalFee: pnl.totalFee,
      exitReason: pnl.exitReason,
      entryTiming: input.entryTimingBySymbol?.[pnl.symbol.toUpperCase()],
      forensicRegime: input.regimeByTradeId[pnl.tradeId] as ForensicRegimeClass | undefined,
    }),
  );
  const summary: Record<string, number> = {};
  for (const row of classifications) {
    summary[String(row.classification)] = (summary[String(row.classification)] ?? 0) + 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    sampleSize: classifications.length,
    classifications,
    summary,
    deterministicHash: deterministicHash({ sampleSize: classifications.length, summary }),
  };
}

export function buildWinningPatternReport(input: {
  pnlEntries: PnlLedgerEntry[];
  strategyByTradeId: Record<string, string>;
  regimeByTradeId: Record<string, ForensicRegimeClass | string>;
  entryTimingBySymbol?: Record<string, EntryTimingRecord>;
}): TradePatternReport {
  const wins = input.pnlEntries.filter((row) => row.netPnL > 0);
  const sampleSize = input.pnlEntries.length;
  const classifications = wins.map((pnl) =>
    classifyWinningPattern({
      tradeId: pnl.tradeId,
      symbol: pnl.symbol,
      strategy: input.strategyByTradeId[pnl.tradeId] ?? "UNKNOWN",
      regime: String(input.regimeByTradeId[pnl.tradeId] ?? "UNKNOWN"),
      netPnL: pnl.netPnL,
      sampleSize,
      entryTiming: input.entryTimingBySymbol?.[pnl.symbol.toUpperCase()],
      exitReason: pnl.exitReason,
    }),
  );
  const summary: Record<string, number> = {};
  for (const row of classifications) {
    summary[String(row.classification)] = (summary[String(row.classification)] ?? 0) + 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    sampleSize: classifications.length,
    classifications,
    summary,
    deterministicHash: deterministicHash({ sampleSize: classifications.length, summary }),
  };
}
