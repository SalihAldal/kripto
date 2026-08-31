export type ClosedTrade = {
  symbol: string;
  lane: string;
  score: number;
  qty: number;
  entry: number;
  exit: number;
  gross: number;
  fees: number;
  spreadCost: number;
  slippageCost: number;
  net: number;
  holdMs: number;
  reason: string | null;
};

export type PerformanceSnapshot = {
  startEquity: number;
  currentEquity: number;
  peakEquity: number;
  drawdownPct: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netProfit: number;
  feesPaid: number;
  spreadCost: number;
  slippageCost: number;
  profitFactor: number | null;
  expectancy: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  medianTrade: number | null;
  maxWinner: number | null;
  maxLoser: number | null;
  maxDrawdown: number;
  averageHoldingMs: number | null;
  sample: "OK" | "INSUFFICIENT_SAMPLE";
};

export function summarizeTrades(input: {
  startEquity: number;
  equity: number;
  peak: number;
  maxDrawdown: number;
  unrealized: number;
  trades: ClosedTrade[];
  minSample?: number;
}): PerformanceSnapshot {
  const trades = input.trades;
  const nets = trades.map((row) => row.net);
  const wins = trades.filter((row) => row.net > 0);
  const losses = trades.filter((row) => row.net <= 0);
  const grossProfit = wins.reduce((sum, row) => sum + row.net, 0);
  const grossLoss = Math.abs(losses.reduce((sum, row) => sum + row.net, 0));
  const feesPaid = trades.reduce((sum, row) => sum + row.fees, 0);
  const n = trades.length;
  const min = input.minSample ?? 20;
  const sorted = [...nets].sort((a, b) => a - b);
  return {
    startEquity: input.startEquity,
    currentEquity: input.equity,
    peakEquity: input.peak,
    drawdownPct: input.peak > 0 ? ((input.peak - input.equity) / input.peak) * 100 : 0,
    realizedPnl: nets.reduce((sum, v) => sum + v, 0),
    unrealizedPnl: input.unrealized,
    totalTrades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? wins.length / n : 0,
    grossProfit,
    grossLoss,
    netProfit: nets.reduce((sum, v) => sum + v, 0),
    feesPaid,
    spreadCost: trades.reduce((sum, row) => sum + row.spreadCost, 0),
    slippageCost: trades.reduce((sum, row) => sum + row.slippageCost, 0),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    expectancy: n ? nets.reduce((sum, v) => sum + v, 0) / n : null,
    averageWin: wins.length ? grossProfit / wins.length : null,
    averageLoss: losses.length ? -grossLoss / losses.length : null,
    medianTrade: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    maxWinner: wins.length ? Math.max(...wins.map((row) => row.net)) : null,
    maxLoser: losses.length ? Math.min(...losses.map((row) => row.net)) : null,
    maxDrawdown: input.maxDrawdown,
    averageHoldingMs: n ? trades.reduce((sum, row) => sum + row.holdMs, 0) / n : null,
    sample: n >= min ? "OK" : "INSUFFICIENT_SAMPLE",
  };
}

export function laneTable(trades: ClosedTrade[]) {
  const lanes = ["EARLY", "STEADY", "MOMENTUM", "CONTINUATION"];
  return lanes.map((lane) => {
    const rows = trades.filter((row) => row.lane === lane);
    return { lane, ...summarizeTrades({ startEquity: 0, equity: 0, peak: 0, maxDrawdown: 0, unrealized: 0, trades: rows, minSample: 20 }) };
  });
}
