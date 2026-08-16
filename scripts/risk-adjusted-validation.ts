/**
 * Risk-adjusted performance validation — BEFORE vs AFTER full optimization stack.
 */
import fs from "node:fs";
import path from "node:path";
import { shouldRejectHighRiskLowConfidenceEntry, TRADE_QUALITY_POLICY } from "../src/server/execution/profit-thresholds";
import { resolveRiskEfficiencyAdjustment } from "../src/server/execution/risk-efficiency.service";
import { computeRiskAdjustedMetrics } from "../src/server/execution/risk-adjusted-performance.service";
import type { PortfolioPositionInput } from "../src/server/trading-core/portfolio/portfolio-types";

const ROOT = path.join(process.cwd(), "brainos-lab/simulation-v1");
const SIM_ACCOUNT_EQUITY = 10_000;

function round(n: number, d = 4) {
  return Math.round(n * 10 ** d) / 10 ** d;
}

type Trade = Record<string, number | string>;

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
    side: "BUY",
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
  stack: "none" | "full",
): { trade: Trade; consecutiveLosses: number } {
  let positionSize = Number(trade.positionSize);
  let pnlUsdt = Number(trade.pnlUsdt);
  const exitReason = String(trade.exitReason);

  if (stack === "full") {
    const baseStopPct = ((Number(trade.entryPrice) - Number(trade.stopLoss)) / Number(trade.entryPrice)) * 100;
    const rrRatio =
      Number(trade.entryPrice) > Number(trade.stopLoss)
        ? (Number(trade.takeProfit) - Number(trade.entryPrice)) / (Number(trade.entryPrice) - Number(trade.stopLoss))
        : 0;
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
      notional: positionSize,
      quantity: positionSize / Math.max(Number(trade.entryPrice), 1),
      accountEquity: SIM_ACCOUNT_EQUITY,
      symbol: String(trade.symbol),
      strategy: String(trade.strategy),
      openPositions: mapOpenPositions(priorAccepted),
    });
    positionSize = adj.adjustedNotional;

    if (exitReason === "TIMEOUT" && pnlUsdt <= 0) {
      if (
        Number(trade.confidence) >= TRADE_QUALITY_POLICY.minConfidenceForQualityTimeoutExit &&
        rrRatio >= TRADE_QUALITY_POLICY.minRewardRiskForQualityTimeoutExit
      ) {
        const towardTp = 0.2;
        const exitPrice = Number(trade.entryPrice) + (Number(trade.takeProfit) - Number(trade.entryPrice)) * towardTp;
        pnlUsdt = round((positionSize * ((exitPrice - Number(trade.entryPrice)) / Number(trade.entryPrice)) * 100) / 100, 4);
      } else {
        pnlUsdt = round(pnlUsdt * (positionSize / Math.max(Number(trade.positionSize), 1)), 4);
      }
    } else {
      pnlUsdt = round(pnlUsdt * (positionSize / Math.max(Number(trade.positionSize), 1)), 4);
    }
  }

  const nextLosses = pnlUsdt < 0 ? consecutiveLosses + 1 : 0;
  return { trade: { ...trade, positionSize, pnlUsdt }, consecutiveLosses: nextLosses };
}

function simulateCohort(trades: Trade[], stack: "none" | "full") {
  const ordered = [...trades].sort((a, b) => Number(a.tradeNumber) - Number(b.tradeNumber));
  const processed: Trade[] = [];
  let consecutiveLosses = 0;
  let equity = SIM_ACCOUNT_EQUITY;
  let peak = SIM_ACCOUNT_EQUITY;
  for (const trade of ordered) {
    const equityDrawdownPercent = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    const result = recomputeTrade(trade, processed, consecutiveLosses, equityDrawdownPercent, stack);
    processed.push(result.trade);
    consecutiveLosses = result.consecutiveLosses;
    equity += Number(result.trade.pnlUsdt);
    peak = Math.max(peak, equity);
  }
  return computeRiskAdjustedMetrics(processed.map((t) => Number(t.pnlUsdt)), SIM_ACCOUNT_EQUITY);
}

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "accepted-trades.before-pf.json"), "utf8")) as Trade[];
const cohort = applyEntryQuality(raw);
const before = simulateCohort(raw, "none");
const after = simulateCohort(cohort, "full");

console.log("=== Risk-Adjusted Performance Validation ===\n");
console.log("### A. Original baseline (15 trades, no stack)");
console.log(formatMetrics(before));
console.log("\n### B. Full stack (14 trades: entry quality + risk efficiency + risk-adjusted sizing + quality timeout)");
console.log(formatMetrics(after));
console.log("\n### C. BEFORE vs AFTER delta");
console.log("| KPI | BEFORE | AFTER | Delta |");
console.log("| --- | ---: | ---: | ---: |");
const rows: Array<[string, number, number]> = [
  ["Trade count", before.tradeCount, after.tradeCount],
  ["Sharpe Ratio", before.sharpeRatio, after.sharpeRatio],
  ["Sortino Ratio", before.sortinoRatio, after.sortinoRatio],
  ["Profit Factor", before.profitFactor, after.profitFactor],
  ["Max Drawdown", before.maxDrawdown, after.maxDrawdown],
  ["Volatility", before.volatility, after.volatility],
  ["Expectancy", before.expectancy, after.expectancy],
  ["Capital Efficiency", before.capitalEfficiency, after.capitalEfficiency],
  ["Portfolio Stability", before.portfolioStability, after.portfolioStability],
  ["Total PnL", before.totalPnl, after.totalPnl],
];
for (const [label, b, a] of rows) {
  const delta = round(a - b, 4);
  console.log(`| ${label} | ${b} | ${a} | ${delta >= 0 ? "+" : ""}${delta} |`);
}

function formatMetrics(m: ReturnType<typeof computeRiskAdjustedMetrics>) {
  return `Sharpe ${m.sharpeRatio}, Sortino ${m.sortinoRatio}, PF ${m.profitFactor}, MaxDD ${m.maxDrawdown}, Stability ${m.portfolioStability}, PnL ${m.totalPnl}`;
}
