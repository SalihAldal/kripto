import type { PnlLedgerEntry } from "@/src/server/forensics/forensic.types";

function round(value: number, digits = 8) {
  return Number(value.toFixed(digits));
}

export function buildCanonicalBaseline(input: { pnlEntries: PnlLedgerEntry[] }) {
  const entries = input.pnlEntries;
  const tradeCount = entries.length;
  if (tradeCount === 0) {
    return {
      generatedAt: new Date().toISOString(),
      tradeCount: 0,
      winRate: 0,
      grossPnL: 0,
      fees: 0,
      netPnL: 0,
      profitFactor: 0,
      expectancy: 0,
      maxDrawdown: 0,
      averageWin: 0,
      averageLoss: 0,
      averageHold: 0,
      medianHold: 0,
      aiAlignment: "NOT_PROVEN",
      entryQuality: "NOT_PROVEN",
      exitModelQuality: "NOT_PROVEN",
      feeStatus: "UNKNOWN",
      scannerDiscoveryQuality: "NOT_PROVEN",
    };
  }

  const grossPnL = entries.reduce((sum, row) => sum + row.grossPnL, 0);
  const fees = entries.reduce((sum, row) => sum + row.totalFee, 0);
  const netPnL = entries.reduce((sum, row) => sum + row.netPnL, 0);
  const wins = entries.filter((row) => row.netPnL > 0);
  const losses = entries.filter((row) => row.netPnL < 0);
  const grossWins = wins.reduce((sum, row) => sum + row.netPnL, 0);
  const grossLossAbs = Math.abs(losses.reduce((sum, row) => sum + row.netPnL, 0));
  const profitFactor = grossLossAbs > 0 ? grossWins / grossLossAbs : grossWins > 0 ? Number.POSITIVE_INFINITY : 0;
  const expectancy = netPnL / tradeCount;
  const averageWin = wins.length > 0 ? grossWins / wins.length : 0;
  const averageLoss = losses.length > 0 ? grossLossAbs / losses.length : 0;
  const holdDurations = entries
    .map((row) => Number(row.exitForensics?.holdDurationMs ?? row.exitForensics?.durationMs ?? 0))
    .filter((ms) => Number.isFinite(ms) && ms > 0)
    .sort((a, b) => a - b);
  const averageHold =
    holdDurations.length > 0 ? holdDurations.reduce((sum, ms) => sum + ms, 0) / holdDurations.length : 0;
  const medianHold = holdDurations.length > 0 ? holdDurations[Math.floor(holdDurations.length / 2)] ?? 0 : 0;

  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const row of entries) {
    equity += row.netPnL;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const feePassRate =
    entries.filter((row) => row.feeReconciliationStatus === "PASS").length / Math.max(1, entries.length);
  const positionMonitorShare =
    entries.filter((row) => row.exitModel === "POSITION_MONITOR").length / Math.max(1, entries.length);

  return {
    generatedAt: new Date().toISOString(),
    tradeCount,
    winRate: round((wins.length / tradeCount) * 100, 4),
    grossPnL: round(grossPnL),
    fees: round(fees),
    netPnL: round(netPnL),
    profitFactor: round(profitFactor, 4),
    expectancy: round(expectancy),
    maxDrawdown: round(maxDrawdown),
    averageWin: round(averageWin),
    averageLoss: round(averageLoss),
    averageHold: round(averageHold, 2),
    medianHold: round(medianHold, 2),
    aiAlignment: tradeCount >= 20 ? "PARTIAL" : "NOT_PROVEN",
    entryQuality: tradeCount >= 20 ? "PARTIAL" : "NOT_PROVEN",
    exitModelQuality: positionMonitorShare > 0 ? "PARTIAL" : "NOT_PROVEN",
    feeStatus: feePassRate >= 0.99 ? "PASS" : feePassRate > 0 ? "PARTIAL" : "UNKNOWN",
    scannerDiscoveryQuality: tradeCount >= 20 ? "PARTIAL" : "NOT_PROVEN",
  };
}
