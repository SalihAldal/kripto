/**
 * Risk efficiency validation — same accepted cohort, BEFORE vs AFTER adaptive sizing/SL.
 */
import fs from "node:fs";
import path from "node:path";
import { shouldRejectHighRiskLowConfidenceEntry } from "../src/server/execution/profit-thresholds";
import {
  computeDrawdownMetrics,
  resolveRiskEfficiencyAdjustment,
} from "../src/server/execution/risk-efficiency.service";
import type { PortfolioPositionInput } from "../src/server/trading-core/portfolio/portfolio-types";

const ROOT = path.join(process.cwd(), "brainos-lab/simulation-v1");
const SIM_ACCOUNT_EQUITY = 10_000;

function round(n: number, d = 4) {
  return Math.round(n * 10 ** d) / 10 ** d;
}

type Trade = Record<string, number | string | boolean | null | object>;

function regimeRiskMultiplier(regime: string): number {
  if (regime === "volatile") return 0.72;
  if (regime === "low_liquidity") return 0.65;
  if (regime === "trending") return 0.92;
  return 0.85;
}

function mapOpenPositions(prior: Trade[]): PortfolioPositionInput[] {
  return prior.map((trade, index) => ({
    id: String(trade.tradeNumber ?? index),
    symbol: String(trade.symbol),
    side: "LONG",
    quantity: Number(trade.positionSize) / Math.max(Number(trade.entryPrice), 1),
    entryPrice: Number(trade.entryPrice),
    currentPrice: Number(trade.exitPrice ?? trade.entryPrice),
    strategy: String(trade.strategy),
  }));
}

function applyEntryQuality(trades: Trade[]): Trade[] {
  return trades.filter((trade) => {
    const gate = shouldRejectHighRiskLowConfidenceEntry({
      confidencePercent: Number(trade.confidence),
      aiRiskScore: Number(trade.riskScore),
    });
    return !gate.reject;
  });
}

function recomputeTrade(
  trade: Trade,
  priorAccepted: Trade[],
  consecutiveLosses: number,
  equityDrawdownPercent: number,
  useRiskEfficiency: boolean,
): { trade: Trade; consecutiveLosses: number } {
  const basePnl = Number(trade.pnlUsdt);
  const baseSize = Number(trade.positionSize);
  let positionSize = baseSize;
  if (useRiskEfficiency) {
    const baseStopPct =
      ((Number(trade.entryPrice) - Number(trade.stopLoss)) / Number(trade.entryPrice)) * 100;
    const adj = resolveRiskEfficiencyAdjustment({
      baseStopLossPercent: round(baseStopPct, 3),
      atrPercent: round(Number(trade.marketRegime === "volatile" ? 2.4 : 1.2), 3),
      volatilityPercent: Number(trade.marketRegime === "volatile" ? 2.8 : 1.4),
      confidencePercent: Number(trade.confidence),
      aiRiskScore: Number(trade.riskScore),
      marketRegimeRiskMultiplier: regimeRiskMultiplier(String(trade.marketRegime)),
      marketRegime: String(trade.marketRegime),
      consecutiveLosses,
      equityDrawdownPercent,
      notional: baseSize,
      quantity: baseSize / Math.max(Number(trade.entryPrice), 1),
      accountEquity: SIM_ACCOUNT_EQUITY,
      symbol: String(trade.symbol),
      strategy: String(trade.strategy),
      openPositions: mapOpenPositions(priorAccepted),
    });
    positionSize = adj.adjustedNotional;
  }
  const pnlUsdt = round(basePnl * (positionSize / Math.max(baseSize, 1)), 4);
  const nextLosses = pnlUsdt < 0 ? consecutiveLosses + 1 : 0;
  return {
    trade: { ...trade, positionSize, pnlUsdt },
    consecutiveLosses: nextLosses,
  };
}

function simulateCohort(trades: Trade[], useRiskEfficiency: boolean) {
  const ordered = [...trades].sort((a, b) => Number(a.tradeNumber) - Number(b.tradeNumber));
  const processed: Trade[] = [];
  let consecutiveLosses = 0;
  let equity = SIM_ACCOUNT_EQUITY;
  let peak = SIM_ACCOUNT_EQUITY;
  for (const trade of ordered) {
    const equityDrawdownPercent = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    const result = recomputeTrade(
      trade,
      processed,
      consecutiveLosses,
      equityDrawdownPercent,
      useRiskEfficiency,
    );
    processed.push(result.trade);
    consecutiveLosses = result.consecutiveLosses;
    equity += Number(result.trade.pnlUsdt);
    peak = Math.max(peak, equity);
  }
  const pnls = processed.map((t) => Number(t.pnlUsdt));
  const wins = processed.filter((t) => Number(t.pnlUsdt) > 0);
  const losses = processed.filter((t) => Number(t.pnlUsdt) <= 0);
  const grossProfit = wins.reduce((s, t) => s + Number(t.pnlUsdt), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + Number(t.pnlUsdt), 0));
  const drawdown = computeDrawdownMetrics(pnls, SIM_ACCOUNT_EQUITY);
  const expectancy = pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
  const mean = expectancy;
  const variance = pnls.length ? pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / pnls.length : 0;
  const sharpe = variance > 0 ? mean / Math.sqrt(variance) : 0;
  const downside = pnls.filter((p) => p < 0);
  const downsideVar = downside.length ? downside.reduce((s, p) => s + p ** 2, 0) / downside.length : 0;
  const sortino = downsideVar > 0 ? mean / Math.sqrt(downsideVar) : sharpe;
  return {
    accepted: processed.length,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 3) : 999,
    maxDrawdown: drawdown.maxDrawdown,
    averageDrawdown: drawdown.averageDrawdown,
    recoveryFactor: drawdown.recoveryFactor,
    capitalEfficiency: drawdown.capitalEfficiency,
    sharpe: round(sharpe, 3),
    sortino: round(sortino, 3),
    expectancy: round(expectancy, 4),
    totalPnl: drawdown.totalPnl,
    avgWin: wins.length ? round(grossProfit / wins.length, 4) : 0,
    avgLoss: losses.length ? round(grossLoss / losses.length, 4) : 0,
  };
}

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "accepted-trades.before-pf.json"), "utf8")) as Trade[];
const cohort = applyEntryQuality(raw);
const baseline15 = simulateCohort(raw, false);
const entryQuality14Before = simulateCohort(cohort, false);
const entryQuality14After = simulateCohort(cohort, true);

console.log("=== Risk Efficiency Validation ===\n");
console.log("### A. Original 15-trade cohort (baseline)");
printRow(baseline15, entryQuality14After, "baseline15→combined");

console.log("\n### B. Entry-quality cohort (14 trades, same frequency policy)");
console.log(`Cohort: ${cohort.length} trades (${raw.length - cohort.length} blocked by entry quality)\n`);
console.log("| KPI | BEFORE sizing | AFTER risk efficiency | Delta |");
console.log("| --- | ---: | ---: | ---: |");
const rows: Array<[string, number, number]> = [
  ["Accepted trades", entryQuality14Before.accepted, entryQuality14After.accepted],
  ["Profit Factor", entryQuality14Before.profitFactor, entryQuality14After.profitFactor],
  ["Max Drawdown (USDT)", entryQuality14Before.maxDrawdown, entryQuality14After.maxDrawdown],
  ["Avg Drawdown (USDT)", entryQuality14Before.averageDrawdown, entryQuality14After.averageDrawdown],
  ["Recovery Factor", entryQuality14Before.recoveryFactor, entryQuality14After.recoveryFactor],
  ["Capital Efficiency", entryQuality14Before.capitalEfficiency, entryQuality14After.capitalEfficiency],
  ["Sharpe", entryQuality14Before.sharpe, entryQuality14After.sharpe],
  ["Sortino", entryQuality14Before.sortino, entryQuality14After.sortino],
  ["Expectancy (USDT)", entryQuality14Before.expectancy, entryQuality14After.expectancy],
  ["Total PnL (USDT)", entryQuality14Before.totalPnl, entryQuality14After.totalPnl],
  ["Avg Loss (USDT)", entryQuality14Before.avgLoss, entryQuality14After.avgLoss],
];
for (const [label, b, a] of rows) {
  const delta = round(a - b, 4);
  console.log(`| ${label} | ${b} | ${a} | ${delta >= 0 ? "+" : ""}${delta} |`);
}

console.log("\n### C. Combined stack vs original baseline");
console.log("| KPI | BASELINE (15) | COMBINED (14) | Delta |");
console.log("| --- | ---: | ---: | ---: |");
const combinedRows: Array<[string, number, number]> = [
  ["Max Drawdown (USDT)", baseline15.maxDrawdown, entryQuality14After.maxDrawdown],
  ["Profit Factor", baseline15.profitFactor, entryQuality14After.profitFactor],
  ["Avg Loss (USDT)", baseline15.avgLoss, entryQuality14After.avgLoss],
  ["Sortino", baseline15.sortino, entryQuality14After.sortino],
  ["Total PnL (USDT)", baseline15.totalPnl, entryQuality14After.totalPnl],
];
for (const [label, b, a] of combinedRows) {
  const delta = round(a - b, 4);
  console.log(`| ${label} | ${b} | ${a} | ${delta >= 0 ? "+" : ""}${delta} |`);
}

function printRow(before: ReturnType<typeof simulateCohort>, after: ReturnType<typeof simulateCohort>, _tag: string) {
  console.log(`Max DD ${before.maxDrawdown} → ${after.maxDrawdown}, PF ${before.profitFactor} → ${after.profitFactor}`);
}

const adatrades = cohort.filter((t) => String(t.symbol) === "ADATRY");
console.log(
  `\nADATRY concentration: ${adatrades.length} trades, gross pnl BEFORE ${round(
    adatrades.reduce((s, t) => s + Number(t.pnlUsdt), 0),
    4,
  )} USDT`,
);
