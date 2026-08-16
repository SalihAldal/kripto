/**
 * Counterfactual profit-factor analysis on the frozen BEFORE cohort (same 15 trades).
 */
import fs from "node:fs";
import path from "node:path";
import {
  shouldRejectHighRiskLowConfidenceEntry,
  TRADE_QUALITY_POLICY,
} from "../src/server/execution/profit-thresholds";

const ROOT = path.join(process.cwd(), "brainos-lab/simulation-v1");
const before = JSON.parse(fs.readFileSync(path.join(ROOT, "accepted-trades.before-pf.json"), "utf8")) as Array<
  Record<string, number | string>
>;

function round(n: number, d = 4) {
  return Math.round(n * 10 ** d) / 10 ** d;
}

type SimTrade = Record<string, number | string>;

function applyPolicy(trade: SimTrade): SimTrade | null {
  const entryQ = shouldRejectHighRiskLowConfidenceEntry({
    confidencePercent: Number(trade.confidence),
    aiRiskScore: Number(trade.riskScore),
  });
  if (entryQ.reject) return null;

  let pnlUsdt = Number(trade.pnlUsdt);
  let exitReason = String(trade.exitReason);
  if (exitReason === "TIMEOUT" && pnlUsdt <= 0) {
    const entryPrice = Number(trade.entryPrice);
    const stopLoss = Number(trade.stopLoss);
    const takeProfit = Number(trade.takeProfit);
    const rr = (takeProfit - entryPrice) / (entryPrice - stopLoss);
    if (
      Number(trade.confidence) >= TRADE_QUALITY_POLICY.minConfidenceForQualityTimeoutExit &&
      rr >= TRADE_QUALITY_POLICY.minRewardRiskForQualityTimeoutExit
    ) {
      const towardTp = 0.2;
      const exitPrice = entryPrice + (takeProfit - entryPrice) * towardTp;
      pnlUsdt = round((Number(trade.positionSize) * ((exitPrice - entryPrice) / entryPrice) * 100) / 100, 4);
      exitReason = "TIMEOUT_QUALITY_EXIT";
    }
  }
  return { ...trade, pnlUsdt, exitReason };
}

function computeKpis(trades: SimTrade[]) {
  const wins = trades.filter((t) => Number(t.pnlUsdt) > 0);
  const losses = trades.filter((t) => Number(t.pnlUsdt) <= 0);
  const grossProfit = wins.reduce((s, t) => s + Number(t.pnlUsdt), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + Number(t.pnlUsdt), 0));
  const profitFactor = grossLoss > 0 ? round(grossProfit / grossLoss, 3) : 999;
  const pnls = trades.map((t) => Number(t.pnlUsdt));
  const expectancy = trades.length ? round(pnls.reduce((a, b) => a + b, 0) / trades.length, 4) : 0;
  const mean = expectancy;
  const variance = trades.length ? pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / trades.length : 0;
  const sharpeRatio = variance > 0 ? round(mean / Math.sqrt(variance), 3) : 0;
  const downside = pnls.filter((p) => p < 0);
  const downsideVar = downside.length ? downside.reduce((s, p) => s + p ** 2, 0) / downside.length : 0;
  const sortinoRatio = downsideVar > 0 ? round(mean / Math.sqrt(downsideVar), 3) : sharpeRatio;
  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const p of pnls) {
    equity += p;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return {
    accepted: trades.length,
    winRate: trades.length ? round((wins.length / trades.length) * 100, 2) : 0,
    profitFactor,
    avgWin: wins.length ? round(grossProfit / wins.length, 4) : 0,
    avgLoss: losses.length ? round(grossLoss / losses.length, 4) : 0,
    riskRewardRatio: losses.length ? round(grossProfit / wins.length / (grossLoss / losses.length), 3) : 0,
    sharpeRatio,
    sortinoRatio,
    maxDrawdown: round(maxDrawdown, 4),
    expectancy,
    totalPnl: round(pnls.reduce((a, b) => a + b, 0), 4),
    timeoutLosses: trades.filter((t) => t.exitReason === "TIMEOUT" && Number(t.pnlUsdt) <= 0).length,
  };
}

const beforeKpis = computeKpis(before);
const afterTrades = before.map(applyPolicy).filter((t): t is SimTrade => t !== null);
const afterKpis = computeKpis(afterTrades);
const rejected = before.filter((t) => applyPolicy(t) === null);

console.log("=== Counterfactual PF (same 15-trade cohort) ===\n");
console.log("| KPI | BEFORE | AFTER | Delta |");
console.log("| --- | ---: | ---: | ---: |");
const rows: Array<[string, number, number]> = [
  ["Accepted trades", beforeKpis.accepted, afterKpis.accepted],
  ["Win rate %", beforeKpis.winRate, afterKpis.winRate],
  ["Profit Factor", beforeKpis.profitFactor, afterKpis.profitFactor],
  ["Avg Win (USDT)", beforeKpis.avgWin, afterKpis.avgWin],
  ["Avg Loss (USDT)", beforeKpis.avgLoss, afterKpis.avgLoss],
  ["Risk/Reward", beforeKpis.riskRewardRatio, afterKpis.riskRewardRatio],
  ["Sharpe", beforeKpis.sharpeRatio, afterKpis.sharpeRatio],
  ["Sortino", beforeKpis.sortinoRatio, afterKpis.sortinoRatio],
  ["Max Drawdown (USDT)", beforeKpis.maxDrawdown, afterKpis.maxDrawdown],
  ["Expectancy (USDT)", beforeKpis.expectancy, afterKpis.expectancy],
  ["Total PnL (USDT)", beforeKpis.totalPnl, afterKpis.totalPnl],
  ["Timeout losses", beforeKpis.timeoutLosses, afterKpis.timeoutLosses],
];
for (const [label, b, a] of rows) {
  const delta = round(a - b, 4);
  console.log(`| ${label} | ${b} | ${a} | ${delta >= 0 ? "+" : ""}${delta} |`);
}
console.log("\nRejected entry trades:", rejected.map((t) => `#${t.tradeNumber} ${t.symbol} risk=${t.riskScore} conf=${t.confidence} pnl=${t.pnlUsdt}`).join("; "));
