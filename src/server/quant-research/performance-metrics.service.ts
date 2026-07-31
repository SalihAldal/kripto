import type { PerformanceMetrics } from "@/src/server/quant-research/quant-research.types";

export function computePerformanceMetrics(returns: number[]): PerformanceMetrics {
  if (returns.length === 0) {
    return emptyMetrics();
  }

  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r < 0);
  const winRate = (wins.length / returns.length) * 100;
  const grossProfit = wins.reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
  const avgReturnPct = returns.reduce((s, r) => s + r, 0) / returns.length;
  const expectancy = avgReturnPct;
  const totalReturnPct = returns.reduce((s, r) => s + r, 0);

  const mean = avgReturnPct;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance) || 0.0001;
  const sharpe = (mean / stdDev) * Math.sqrt(252);

  const downside = returns.filter((r) => r < 0);
  const downsideVar = downside.length > 0 ? downside.reduce((s, r) => s + r ** 2, 0) / downside.length : 0.0001;
  const sortino = (mean / Math.sqrt(downsideVar)) * Math.sqrt(252);

  const { maxDrawdownPct, recoveryFactor, ulcerIndex } = computeDrawdownStats(returns);
  const calmar = maxDrawdownPct > 0 ? totalReturnPct / maxDrawdownPct : totalReturnPct;
  const omega = computeOmega(returns, 0);
  const { alpha, beta } = computeAlphaBeta(returns);

  return {
    tradeCount: returns.length,
    winRate: Number(winRate.toFixed(3)),
    profitFactor: Number(profitFactor.toFixed(3)),
    expectancy: Number(expectancy.toFixed(4)),
    sharpe: Number(sharpe.toFixed(3)),
    sortino: Number(sortino.toFixed(3)),
    calmar: Number(calmar.toFixed(3)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(3)),
    recoveryFactor: Number(recoveryFactor.toFixed(3)),
    ulcerIndex: Number(ulcerIndex.toFixed(3)),
    omega: Number(omega.toFixed(3)),
    alpha: Number(alpha.toFixed(4)),
    beta: Number(beta.toFixed(4)),
    totalReturnPct: Number(totalReturnPct.toFixed(3)),
    avgReturnPct: Number(avgReturnPct.toFixed(4)),
  };
}

function computeDrawdownStats(returns: number[]) {
  let equity = 100;
  let peak = 100;
  let maxDrawdownPct = 0;
  let ulcerSum = 0;
  const drawdowns: number[] = [];

  for (const r of returns) {
    equity *= 1 + r / 100;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    drawdowns.push(dd);
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    ulcerSum += dd ** 2;
  }

  const finalEquity = equity;
  const recoveryFactor = maxDrawdownPct > 0 ? (finalEquity - 100) / maxDrawdownPct : finalEquity - 100;
  const ulcerIndex = Math.sqrt(ulcerSum / returns.length);

  return { maxDrawdownPct, recoveryFactor, ulcerIndex };
}

function computeOmega(returns: number[], threshold: number) {
  let gains = 0;
  let losses = 0;
  for (const r of returns) {
    if (r > threshold) gains += r - threshold;
    else losses += threshold - r;
  }
  return losses > 0 ? gains / losses : gains > 0 ? 99 : 0;
}

function computeAlphaBeta(returns: number[]) {
  const market = returns.map((_, i) => Math.sin(i * 0.1) * 0.5);
  const meanR = returns.reduce((s, r) => s + r, 0) / returns.length;
  const meanM = market.reduce((s, r) => s + r, 0) / market.length;
  let cov = 0;
  let varM = 0;
  for (let i = 0; i < returns.length; i++) {
    cov += (returns[i]! - meanR) * (market[i]! - meanM);
    varM += (market[i]! - meanM) ** 2;
  }
  const beta = varM > 0 ? cov / varM : 0;
  const alpha = meanR - beta * meanM;
  return { alpha, beta };
}

function emptyMetrics(): PerformanceMetrics {
  return {
    tradeCount: 0,
    winRate: 0,
    profitFactor: 0,
    expectancy: 0,
    sharpe: 0,
    sortino: 0,
    calmar: 0,
    maxDrawdownPct: 0,
    recoveryFactor: 0,
    ulcerIndex: 0,
    omega: 0,
    alpha: 0,
    beta: 0,
    totalReturnPct: 0,
    avgReturnPct: 0,
  };
}

export function scoreMetrics(metrics: PerformanceMetrics) {
  return (
    metrics.winRate * 0.15 +
    metrics.profitFactor * 10 +
    metrics.sharpe * 5 +
    metrics.expectancy * 20 -
    metrics.maxDrawdownPct * 2
  );
}
