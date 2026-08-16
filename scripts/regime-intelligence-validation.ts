/**
 * Market regime intelligence validation — flat vs regime-aware pipeline on historical cohort.
 */
import fs from "node:fs";
import path from "node:path";
import { evaluateRankingGate } from "../src/server/scanner/candidate-ranking.service";
import {
  computeRegimePerformanceByGroup,
  evaluateStrategyRegimeAlignment,
  normalizeMarketRegimeLabel,
  resolveRegimePipelinePolicy,
} from "../src/server/scanner/regime-intelligence.service";
import { evaluateRiskRules } from "../src/server/risk/risk-evaluation.service";
import { shouldRejectHighRiskLowConfidenceEntry } from "../src/server/execution/profit-thresholds";
import { computeRiskAdjustedMetrics } from "../src/server/execution/risk-adjusted-performance.service";

const ROOT = path.join(process.cwd(), "brainos-lab/simulation-v1");
type Trade = Record<string, number | string>;

function round(n: number, d = 4) {
  return Math.round(n * 10 ** d) / 10 ** d;
}

function effectiveConfig() {
  return {
    maxRiskPerTrade: 1,
    maxDailyLossPercent: 5,
    maxWeeklyLossPercent: 7,
    dailyLossReferenceTry: 100000,
    weeklyLossReferenceTry: 100000,
    maxOpenPositions: 3,
    minConfidenceThreshold: 45,
    maxSpreadThreshold: 0.25,
    minLiquidityThreshold: 5_000_000,
    minExpectedProfitThreshold: 0.2,
    maxSlippageThreshold: 0.45,
    cooldownMinutes: 30,
    consecutiveLossBreaker: 3,
    apiFailureBreaker: 4,
    abnormalVolatilityThreshold: 3.2,
    emergencyBrakeEnabled: true,
    stopLossRequired: true,
  };
}

function wouldAcceptFlat(trade: Trade): boolean {
  const rankingGate = evaluateRankingGate({
    rankingScore: Number(trade.rankingScore),
    confidencePercent: Number(trade.confidence),
    riskScore: Number(trade.riskScore),
    entryThresholdScore: 55,
  });
  if (!rankingGate.pass) return false;
  const entryQuality = shouldRejectHighRiskLowConfidenceEntry({
    confidencePercent: Number(trade.confidence),
    aiRiskScore: Number(trade.riskScore),
  });
  if (entryQuality.reject) return false;
  return Number(trade.pnlUsdt) !== undefined;
}

function wouldAcceptRegimeAware(trade: Trade): boolean {
  const regime = String(trade.marketRegime);
  const policy = resolveRegimePipelinePolicy({
    marketRegime: regime,
    volatilityPercent: regime === "volatile" ? 2.8 : 1.4,
    liquidity24h: 8_000_000,
  });
  if (!policy.openTradeAllowed) return false;
  const rankingGate = evaluateRankingGate({
    rankingScore: Number(trade.rankingScore),
    confidencePercent: Number(trade.confidence),
    riskScore: Number(trade.riskScore),
    marketRegime: regime,
    volatilityPercent: regime === "volatile" ? 2.8 : 1.4,
    liquidity24h: 8_000_000,
  });
  if (!rankingGate.pass) return false;
  const alignment = evaluateStrategyRegimeAlignment({
    strategy: String(trade.strategy),
    allowedStrategyTypes: policy.allowedStrategyTypes,
  });
  if (!alignment.aligned) return false;
  const entryQuality = shouldRejectHighRiskLowConfidenceEntry({
    confidencePercent: Number(trade.confidence),
    aiRiskScore: Number(trade.riskScore),
    marketRegime: regime,
  });
  if (entryQuality.reject) return false;
  const riskReasons = evaluateRiskRules({
    config: effectiveConfig(),
    metrics: {
      confidencePercent: Number(trade.confidence),
      spreadPercent: 0.1,
      liquidity24h: 8_000_000,
      expectedProfitPercent: 0.5,
      slippagePercent: 0.15,
      volatilityPercent: regime === "volatile" ? 2.8 : 1.4,
      riskPerTradePercent: 0.8,
      stopLossConfigured: true,
      aiRiskScore: Number(trade.riskScore),
      marketRegime: regime,
      volatilityPercent: regime === "volatile" ? 2.8 : 1.4,
    },
    state: {
      paused: false,
      openPositionCount: 0,
      dailyLossAbs: 0,
      dailyLossPercent: 0,
      weeklyLossAbs: 0,
      weeklyLossPercent: 0,
      consecutiveLosses: 0,
      apiFailureCount: 0,
    },
  });
  return riskReasons.length === 0;
}

const trades = JSON.parse(fs.readFileSync(path.join(ROOT, "accepted-trades.before-pf.json"), "utf8")) as Trade[];
const flatAccepted = trades.filter(wouldAcceptFlat);
const regimeAccepted = trades.filter(wouldAcceptRegimeAware);
const flatMetrics = computeRiskAdjustedMetrics(flatAccepted.map((t) => Number(t.pnlUsdt)));
const regimeMetrics = computeRiskAdjustedMetrics(regimeAccepted.map((t) => Number(t.pnlUsdt)));
const beforeByRegime = computeRegimePerformanceByGroup(
  flatAccepted.map((t) => ({ pnlUsdt: Number(t.pnlUsdt), marketRegime: String(t.marketRegime) })),
);
const afterByRegime = computeRegimePerformanceByGroup(
  regimeAccepted.map((t) => ({ pnlUsdt: Number(t.pnlUsdt), marketRegime: String(t.marketRegime) })),
);

console.log("=== Market Regime Intelligence Validation ===\n");
console.log("### Pipeline coverage");
console.log("- Ranking: regime entryThresholdScore via resolveRegimePipelinePolicy");
console.log("- Risk: regime confidence/EV/volatility calibration in evaluateRiskRules");
console.log("- Entry quality: regime-aware thresholds in shouldRejectHighRiskLowConfidenceEntry");
console.log("- Sizing: canonical regime classes in risk-adjusted-performance.service.ts");
console.log("- Simulation: strategy-regime alignment + canonical regime metadata\n");

console.log("### Aggregate BEFORE (flat gates) vs AFTER (regime-aware)");
console.log("| KPI | BEFORE | AFTER | Delta |");
console.log("| --- | ---: | ---: | ---: |");
const rows: Array<[string, number, number]> = [
  ["Accepted trades", flatMetrics.tradeCount, regimeMetrics.tradeCount],
  ["Sharpe", flatMetrics.sharpeRatio, regimeMetrics.sharpeRatio],
  ["Sortino", flatMetrics.sortinoRatio, regimeMetrics.sortinoRatio],
  ["Profit Factor", flatMetrics.profitFactor, regimeMetrics.profitFactor],
  ["Max Drawdown", flatMetrics.maxDrawdown, regimeMetrics.maxDrawdown],
  ["Portfolio Stability", flatMetrics.portfolioStability, regimeMetrics.portfolioStability],
  ["Total PnL", flatMetrics.totalPnl, regimeMetrics.totalPnl],
];
for (const [label, b, a] of rows) {
  console.log(`| ${label} | ${b} | ${a} | ${round(a - b, 4)} |`);
}

console.log("\n### Regime Classification (canonical)");
for (const regime of [...new Set(trades.map((t) => normalizeMarketRegimeLabel(String(t.marketRegime))))]) {
  console.log(`- ${regime}`);
}

console.log("\n### Performance by Regime — BEFORE");
for (const row of beforeByRegime.sort((a, b) => a.regime.localeCompare(b.regime))) {
  console.log(`${row.regime}: trades=${row.tradeCount} WR=${row.winRate}% PF=${row.profitFactor} Sharpe=${row.sharpeRatio}`);
}

console.log("\n### Performance by Regime — AFTER");
for (const row of afterByRegime.sort((a, b) => a.regime.localeCompare(b.regime))) {
  console.log(`${row.regime}: trades=${row.tradeCount} WR=${row.winRate}% PF=${row.profitFactor} Sharpe=${row.sharpeRatio}`);
}
