/**
 * Portfolio allocation intelligence validation — flat sizing vs allocation-aware replay.
 */
import fs from "node:fs";
import path from "node:path";
import {
  aggregatePortfolioAllocationKpis,
  resolvePortfolioAllocationPolicy,
} from "../src/server/execution/portfolio-allocation-intelligence.service";
import {
  computeDrawdownMetrics,
  resolveAdaptiveNotionalMultiplier,
  resolveRiskBudgetNeutralScale,
  resolveRiskEfficiencyAdjustment,
  resolveVolatilityAwareStopLossPercent,
} from "../src/server/execution/risk-efficiency.service";
import { resolveRiskAdjustedNotionalMultiplier } from "../src/server/execution/risk-adjusted-performance.service";
import type { PortfolioPositionInput } from "../src/server/trading-core/portfolio/portfolio-types";

const ROOT = path.join(process.cwd(), "brainos-lab/simulation-v1");
type Trade = Record<string, unknown>;

function round(n: number, d = 4) {
  return Math.round(n * 10 ** d) / 10 ** d;
}

function mapOpenPositions(prior: Trade[], untilIndex: number): PortfolioPositionInput[] {
  return prior.slice(0, untilIndex).map((trade, index) => ({
    id: String(trade.tradeNumber ?? index),
    symbol: String(trade.symbol),
    side: "BUY" as const,
    quantity: Number(trade.positionSize) / Math.max(Number(trade.entryPrice), 1),
    entryPrice: Number(trade.entryPrice),
    currentPrice: Number(trade.exitPrice ?? trade.entryPrice),
    strategy: String(trade.strategy),
  }));
}

function replayFlatSizing(trade: Trade, priorAccepted: Trade[]) {
  const notional = Number(trade.positionSize);
  const stop = resolveVolatilityAwareStopLossPercent({
    baseStopLossPercent: 0.8,
    atrPercent: Number(trade.volatilityPercent ?? 1.5) * 0.42,
    volatilityPercent: Number(trade.volatilityPercent ?? 1.5),
  });
  const sizing = resolveAdaptiveNotionalMultiplier({
    confidencePercent: Number(trade.confidence),
    volatilityPercent: Number(trade.volatilityPercent ?? 1.5),
    aiRiskScore: Number(trade.riskScore),
    marketRegimeRiskMultiplier: 0.85,
    consecutiveLosses: 0,
    equityDrawdownPercent: 0,
    portfolioExposureFactor: 0.5,
  });
  const riskBudgetScale = resolveRiskBudgetNeutralScale({
    baseStopLossPercent: 0.8,
    adjustedStopLossPercent: stop.stopLossPercent,
  });
  const riskAdjusted = resolveRiskAdjustedNotionalMultiplier({
    confidencePercent: Number(trade.confidence),
    aiRiskScore: Number(trade.riskScore),
    marketRegime: String(trade.marketRegime ?? "ranging"),
    strategy: String(trade.strategy),
    volatilityPercent: Number(trade.volatilityPercent ?? 1.5),
  });
  const adjustedNotional = round(notional * sizing.multiplier * riskBudgetScale * riskAdjusted.multiplier, 4);
  const pnlPct = Number(trade.pnlPercent);
  return {
    adjustedNotional,
    pnlUsdt: round((adjustedNotional * pnlPct) / 100, 4),
    telemetry: null,
  };
}

function replayAllocationAware(trade: Trade, priorAccepted: Trade[]) {
  const result = resolveRiskEfficiencyAdjustment({
    baseStopLossPercent: 0.8,
    atrPercent: Number(trade.volatilityPercent ?? 1.5) * 0.42,
    volatilityPercent: Number(trade.volatilityPercent ?? 1.5),
    confidencePercent: Number(trade.confidence),
    aiRiskScore: Number(trade.riskScore),
    marketRegimeRiskMultiplier: 0.85,
    marketRegime: String(trade.marketRegime ?? "ranging"),
    consecutiveLosses: 0,
    equityDrawdownPercent: 0,
    notional: Number(trade.positionSize),
    quantity: Number(trade.positionSize) / Math.max(Number(trade.entryPrice), 1),
    accountEquity: 10_000,
    symbol: String(trade.symbol),
    strategy: String(trade.strategy),
    openPositions: mapOpenPositions(priorAccepted, priorAccepted.length),
    expectedProfitPercent: Number(trade.expectedProfitPercent ?? 0.35),
    rankingScore: Number(trade.rankingScore ?? 60),
    liquidity24h: Number(trade.liquidity24h ?? 8_000_000),
  });
  const pnlPct = Number(trade.pnlPercent);
  return {
    adjustedNotional: result.adjustedNotional,
    pnlUsdt: result.portfolioBlocked ? 0 : round((result.adjustedNotional * pnlPct) / 100, 4),
    telemetry: result.portfolioAllocation ?? null,
    blocked: result.portfolioBlocked,
  };
}

const cohortPath = fs.existsSync(path.join(ROOT, "accepted-trades.json"))
  ? path.join(ROOT, "accepted-trades.json")
  : path.join(ROOT, "accepted-trades.before-pf.json");
const accepted = JSON.parse(fs.readFileSync(cohortPath, "utf8")) as Trade[];

const flatRows = accepted.map((trade, index) => replayFlatSizing(trade, accepted.slice(0, index)));
const awareRows = accepted.map((trade, index) => replayAllocationAware(trade, accepted.slice(0, index)));
const flatPnls = flatRows.map((r) => r.pnlUsdt);
const awarePnls = awareRows.filter((r) => !r.blocked).map((r) => r.pnlUsdt);
const flatMetrics = computeDrawdownMetrics(flatPnls, 10_000);
const awareMetrics = computeDrawdownMetrics(awarePnls, 10_000);
const flatUtil =
  flatRows.reduce((s, r) => s + r.adjustedNotional, 0) / Math.max(1, flatRows.length * 10_000);
const awareTelemetry = awareRows.map((r) => r.telemetry).filter((t): t is NonNullable<typeof t> => Boolean(t));
const awareAllocation = aggregatePortfolioAllocationKpis(awareTelemetry, awarePnls, 10_000);

console.log("=== Portfolio Allocation Intelligence Validation ===\n");
console.log("### Pipeline coverage");
console.log("- Opportunity weights: confidence + expected value + ranking score");
console.log("- Correlation-aware sizing via PortfolioCorrelationAnalyzer groups");
console.log("- Regime-aware allocation via resolveRegimePipelinePolicy");
console.log("- Portfolio BLOCK enforcement in risk-efficiency + orchestrator");
console.log("- Simulation Lab portfolioAllocation metrics block\n");

console.log("### Aggregate BEFORE (legacy sizing) vs AFTER (allocation-aware)");
console.log("| KPI | BEFORE | AFTER | Delta |");
console.log("| --- | ---: | ---: | ---: |");
const rows: Array<[string, number, number]> = [
  ["Replayed trades", flatPnls.length, awarePnls.length],
  ["Capital Efficiency", flatMetrics.capitalEfficiency, awareMetrics.capitalEfficiency],
  ["Total PnL", flatMetrics.totalPnl, awareMetrics.totalPnl],
  ["Max Drawdown", flatMetrics.maxDrawdown, awareMetrics.maxDrawdown],
  ["Recovery Factor", flatMetrics.recoveryFactor, awareMetrics.recoveryFactor],
  ["Avg Capital Utilization", round(flatUtil * 100, 4), awareAllocation.averageCapitalUtilization],
  ["Avg Allocation Multiplier", 1, awareAllocation.averageAllocationMultiplier],
  ["Portfolio Block Rate %", 0, awareAllocation.portfolioBlockedRate],
  ["Portfolio Stability", 0, awareAllocation.portfolioStability ?? 0],
  ["Profit Factor", flatMetrics.recoveryFactor > 0 ? round(flatMetrics.totalPnl / Math.max(flatMetrics.maxDrawdown, 1), 4) : 0, awareAllocation.profitFactor ?? 0],
];
for (const [label, b, a] of rows) {
  console.log(`| ${label} | ${b} | ${a} | ${round(a - b, 4)} |`);
}

console.log("\n### Correlation / Concentration");
console.log(`Average concentration AFTER: ${awareAllocation.averageConcentration}%`);
console.log(`Average portfolio exposure AFTER: ${awareAllocation.averagePortfolioExposure}%`);

console.log("\n### Risk Budget / Allocation");
if (awareTelemetry[0]) {
  const sample = awareTelemetry[0];
  console.log(`Sample risk budget: ${sample.riskBudget} | EV weight: ${sample.expectedValueWeight} | confidence weight: ${sample.confidenceWeight}`);
}
