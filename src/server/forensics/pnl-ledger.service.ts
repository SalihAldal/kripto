import type { PnlLedgerEntry, PnlLedgerSummary } from "@/src/server/forensics/forensic.types";
import {
  classifyFeeEdge,
  computeClosedTradeFeeRatio,
  reconcileFeeStatus,
} from "@/src/server/forensics/fee-edge-metrics.service";

export function buildPnlLedgerSummary(entries: PnlLedgerEntry[]): PnlLedgerSummary {
  if (entries.length === 0) {
    return {
      grossPnL: 0,
      totalFees: 0,
      netPnL: 0,
      winRate: 0,
      profitFactor: 0,
      expectancy: 0,
      maxDrawdown: 0,
      averageWin: 0,
      averageLoss: 0,
      consecutiveLosses: 0,
      tradeCount: 0,
    };
  }

  const grossPnL = entries.reduce((acc, row) => acc + row.grossPnL, 0);
  const totalFees = entries.reduce((acc, row) => acc + row.totalFee, 0);
  const netPnL = entries.reduce((acc, row) => acc + row.netPnL, 0);
  const grossPositiveNetNegativeCount = entries.filter((row) => row.grossPnL > 0 && row.netPnL < 0).length;
  const feeClassBreakdown = entries.reduce<
    Partial<Record<"FEE_SAFE" | "FEE_BORDERLINE" | "FEE_EROSION" | "UNKNOWN", number>>
  >((acc, row) => {
    const key = row.feeEdgeClass ?? "UNKNOWN";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const exitModelBreakdown = entries.reduce<Partial<Record<"POSITION_MONITOR" | "REPLAY_WINDOW" | "MANUAL_TIMEOUT", number>>>(
    (acc, row) => {
      const key = row.exitModel;
      if (!key) return acc;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const wins = entries.filter((row) => row.netPnL > 0);
  const losses = entries.filter((row) => row.netPnL < 0);
  const winRate = (wins.length / entries.length) * 100;
  const grossWin = wins.reduce((acc, row) => acc + row.netPnL, 0);
  const grossLossAbs = Math.abs(losses.reduce((acc, row) => acc + row.netPnL, 0));
  const profitFactor = grossLossAbs > 0 ? grossWin / grossLossAbs : grossWin > 0 ? Number.POSITIVE_INFINITY : 0;
  const expectancy = netPnL / entries.length;
  const averageWin = wins.length > 0 ? grossWin / wins.length : 0;
  const averageLoss = losses.length > 0 ? grossLossAbs / losses.length : 0;

  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  let consecutiveLosses = 0;
  let currentLossStreak = 0;
  for (const row of entries) {
    equity += row.netPnL;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    if (row.netPnL < 0) {
      currentLossStreak += 1;
      consecutiveLosses = Math.max(consecutiveLosses, currentLossStreak);
    } else {
      currentLossStreak = 0;
    }
  }

  return {
    grossPnL: Number(grossPnL.toFixed(8)),
    totalFees: Number(totalFees.toFixed(8)),
    netPnL: Number(netPnL.toFixed(8)),
    winRate: Number(winRate.toFixed(4)),
    profitFactor: Number(profitFactor.toFixed(4)),
    expectancy: Number(expectancy.toFixed(8)),
    maxDrawdown: Number(maxDrawdown.toFixed(8)),
    averageWin: Number(averageWin.toFixed(8)),
    averageLoss: Number(averageLoss.toFixed(8)),
    consecutiveLosses,
    tradeCount: entries.length,
    grossPositiveNetNegativeCount,
    feeClassBreakdown,
    exitModelBreakdown,
  };
}

export function reconcileRoundPnl(entries: PnlLedgerEntry[], expectedNet: number) {
  const summary = buildPnlLedgerSummary(entries);
  const delta = Math.abs(summary.netPnL - expectedNet);
  return {
    reconciled: delta <= 0.000001,
    delta,
    summary,
  };
}

export function createPnlLedgerEntry(input: {
  tradeId: string;
  positionId?: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  entryFee: number;
  exitFee: number;
  slippageCost?: number;
  roundId?: string;
  sessionId?: string;
  exitReason?: PnlLedgerEntry["exitReason"];
  exitModel?: PnlLedgerEntry["exitModel"];
  exitForensics?: PnlLedgerEntry["exitForensics"];
  timestamp?: string;
}): PnlLedgerEntry {
  const gross =
    input.side === "LONG"
      ? (input.exitPrice - input.entryPrice) * input.quantity
      : (input.entryPrice - input.exitPrice) * input.quantity;
  const totalFee = input.entryFee + input.exitFee + (input.slippageCost ?? 0);
  const netPnL = gross - totalFee;
  const feeEdgeClass = classifyFeeEdge({
    expectedGross: gross,
    expectedNet: netPnL,
    fee: totalFee,
  });
  const grossPositiveNetNegative = gross > 0 && netPnL < 0;
  const feeReconciliationStatus = reconcileFeeStatus({
    grossPnL: gross,
    entryFee: input.entryFee,
    exitFee: input.exitFee,
    totalFee,
    netPnL,
    slippageCost: input.slippageCost,
  });
  return {
    tradeId: input.tradeId,
    positionId: input.positionId,
    symbol: input.symbol.toUpperCase(),
    roundId: input.roundId,
    sessionId: input.sessionId,
    grossPnL: Number(gross.toFixed(8)),
    entryFee: Number(input.entryFee.toFixed(8)),
    exitFee: Number(input.exitFee.toFixed(8)),
    totalFee: Number(totalFee.toFixed(8)),
    netPnL: Number(netPnL.toFixed(8)),
    feeToGrossRatio: computeClosedTradeFeeRatio({ grossPnL: gross, totalFee }),
    feeEdgeClass,
    grossPositiveNetNegative,
    feeReconciliationStatus,
    exitReason: input.exitReason,
    exitModel: input.exitModel,
    exitForensics: input.exitForensics,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}
