import type { BacktestMetrics, BacktestTrade } from "@/src/server/trading-core/backtest/backtest-types";

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

export function calculateMaxDrawdown(equityCurve: Array<{ equity: number }>) {
  let peak = equityCurve[0]?.equity ?? 0;
  let maxDrawdown = 0;
  for (const row of equityCurve) {
    peak = Math.max(peak, row.equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - row.equity) / peak) * 100);
  }
  return Number(maxDrawdown.toFixed(4));
}

export function calculateBacktestMetrics(
  trades: BacktestTrade[],
  initialBalance: number,
  equityCurve: Array<{ time: number; equity: number }>,
): BacktestMetrics {
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const totalPnl = trades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const returns = trades.map((trade) => trade.returnPercent / 100);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const avgWin = average(wins.map((trade) => trade.netPnl));
  const avgLoss = Math.abs(average(losses.map((trade) => trade.netPnl)));
  const winrate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const expectancy = (winrate / 100) * avgWin - (1 - winrate / 100) * avgLoss;
  const returnStd = stddev(returns);
  const sharpeRatio = returnStd > 0 ? (average(returns) / returnStd) * Math.sqrt(Math.max(1, trades.length)) : 0;

  return {
    tradeCount: trades.length,
    wins: wins.length,
    losses: losses.length,
    winrate: Number(winrate.toFixed(2)),
    totalPnl: Number(totalPnl.toFixed(8)),
    endingBalance: Number((initialBalance + totalPnl).toFixed(8)),
    sharpeRatio: Number(sharpeRatio.toFixed(4)),
    maxDrawdown: calculateMaxDrawdown(equityCurve),
    expectancy: Number(expectancy.toFixed(8)),
    profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(4)) : grossProfit > 0 ? 999 : 0,
  };
}
