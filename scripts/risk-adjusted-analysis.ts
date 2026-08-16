/**
 * Risk-adjusted performance analysis on historical simulation cohort.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "brainos-lab/simulation-v1");
type Trade = Record<string, number | string>;

function round(n: number, d = 4) {
  return Math.round(n * 10 ** d) / 10 ** d;
}

function computeRiskMetrics(pnls: number[], initialEquity = 10_000) {
  const returns = pnls.map((p) => p / initialEquity);
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length ? returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length : 0;
  const std = Math.sqrt(variance);
  const downside = returns.filter((r) => r < 0);
  const downsideVar = downside.length ? downside.reduce((s, r) => s + r ** 2, 0) / downside.length : 0;
  const downsideStd = Math.sqrt(downsideVar);
  const grossProfit = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0));
  let peak = initialEquity;
  let eq = initialEquity;
  let maxDd = 0;
  for (const p of pnls) {
    eq += p;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, peak - eq);
  }
  return {
    sharpe: std > 0 ? round(mean / std, 4) : 0,
    sortino: downsideStd > 0 ? round(mean / downsideStd, 4) : 0,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : 999,
    expectancy: pnls.length ? round(pnls.reduce((a, b) => a + b, 0) / pnls.length, 4) : 0,
    volatility: round(std * 100, 4),
    maxDrawdown: round(maxDd, 4),
    totalPnl: round(pnls.reduce((a, b) => a + b, 0), 4),
  };
}

function leaveOneOut(trades: Trade[]) {
  const base = computeRiskMetrics(trades.map((t) => Number(t.pnlUsdt)));
  return trades.map((trade, idx) => {
    const rest = trades.filter((_, i) => i !== idx);
    const m = computeRiskMetrics(rest.map((t) => Number(t.pnlUsdt)));
    return {
      tradeNumber: trade.tradeNumber,
      symbol: trade.symbol,
      strategy: trade.strategy,
      regime: trade.marketRegime,
      exitReason: trade.exitReason,
      pnlUsdt: trade.pnlUsdt,
      confidence: trade.confidence,
      riskScore: trade.riskScore,
      sharpeDelta: round(m.sharpe - base.sharpe, 4),
      sortinoDelta: round(m.sortino - base.sortino, 4),
    };
  });
}

function groupStats(trades: Trade[], key: keyof Trade) {
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = String(t[key]);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.entries()]
    .map(([k, rows]) => ({ key: k, count: rows.length, ...computeRiskMetrics(rows.map((r) => Number(r.pnlUsdt))) }))
    .sort((a, b) => a.sharpe - b.sharpe);
}

const trades = JSON.parse(fs.readFileSync(path.join(ROOT, "accepted-trades.before-pf.json"), "utf8")) as Trade[];
const ordered = [...trades].sort((a, b) => Number(a.tradeNumber) - Number(b.tradeNumber));
const base = computeRiskMetrics(ordered.map((t) => Number(t.pnlUsdt)));
const loo = leaveOneOut(ordered).sort((a, b) => a.sharpeDelta - b.sharpeDelta);

console.log("=== BASELINE RISK-ADJUSTED METRICS (15 trades) ===");
console.log(base);
console.log("\n=== TRADES THAT MOST REDUCE SHARPE (leave-one-out) ===");
for (const row of loo.slice(0, 5)) {
  console.log(row);
}
console.log("\n=== TRADES THAT MOST REDUCE SORTINO ===");
for (const row of [...loo].sort((a, b) => a.sortinoDelta - b.sortinoDelta).slice(0, 5)) {
  console.log(row);
}
console.log("\n=== STRATEGY STABILITY ===");
for (const row of groupStats(ordered, "strategy")) console.log(row);
console.log("\n=== REGIME STABILITY ===");
for (const row of groupStats(ordered, "marketRegime")) console.log(row);
console.log("\n=== EXIT REASON STABILITY ===");
for (const row of groupStats(ordered, "exitReason")) console.log(row);

const confBuckets = [
  { label: "62-72", min: 62, max: 72 },
  { label: "72-82", min: 72, max: 82 },
  { label: "82+", min: 82, max: 101 },
];
console.log("\n=== CONFIDENCE CALIBRATION ===");
for (const b of confBuckets) {
  const rows = ordered.filter((t) => Number(t.confidence) >= b.min && Number(t.confidence) < b.max);
  if (!rows.length) continue;
  const wins = rows.filter((t) => Number(t.pnlUsdt) > 0).length;
  console.log({ bucket: b.label, trades: rows.length, winRate: round((wins / rows.length) * 100, 2), ...computeRiskMetrics(rows.map((r) => Number(r.pnlUsdt))) });
}
