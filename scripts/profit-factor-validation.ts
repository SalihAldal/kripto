/**
 * Seeded profit-factor validation — BEFORE (legacy exit/entry) vs AFTER (trade quality policy).
 */
import {
  shouldRejectHighRiskLowConfidenceEntry,
  TRADE_QUALITY_POLICY,
} from "../src/server/execution/profit-thresholds";
import { evaluateRiskRules } from "../src/server/risk/risk-evaluation.service";
import { evaluateRankingGate } from "../src/server/scanner/candidate-ranking.service";

const SEED = 42_001;
const TARGET = 100;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function round(n: number, d = 4) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

type SimTrade = {
  confidence: number;
  riskScore: number;
  rankingScore: number;
  liquidity24h: number;
  expectedProfitPercent: number;
  riskPerTradePercent: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  positionSize: number;
  accepted: boolean;
  pnlUsdt: number;
  exitReason: string;
};

function buildTrade(rand: () => number, tradeNumber: number): Omit<SimTrade, "accepted" | "pnlUsdt" | "exitReason"> {
  const confidence = round(52 + rand() * 42, 2);
  const rankingScore = round(40 + rand() * 55, 2);
  const riskScore = round(18 + rand() * 62, 2);
  const liquidity24h = Math.round(200_000 + rand() * 8_000_000);
  const expectedProfitPercent = round(0.15 + rand() * 1.2, 3);
  const riskPerTradePercent = round(0.4 + rand() * 1.1, 3);
  const entryPrice = round(100 + rand() * 900, 2);
  const stopLoss = round(entryPrice * (1 - (0.006 + rand() * 0.012)), 2);
  const takeProfit = round(entryPrice * (1 + (0.012 + rand() * 0.028)), 2);
  const positionSize = round(80 + rand() * 420, 2);
  return {
    confidence,
    riskScore,
    rankingScore,
    liquidity24h,
    expectedProfitPercent,
    riskPerTradePercent,
    entryPrice,
    stopLoss,
    takeProfit,
    positionSize,
  };
}

function passesGates(candidate: ReturnType<typeof buildTrade>, useQualityPolicy: boolean): boolean {
  const rankingGate = evaluateRankingGate({
    rankingScore: candidate.rankingScore,
    confidencePercent: candidate.confidence,
    aiRiskScore: candidate.riskScore,
  });
  if (!rankingGate.pass) return false;
  if (candidate.liquidity24h < 5_000_000) return false;
  const riskReasons = evaluateRiskRules({
    config: {
      maxRiskPerTrade: 1,
      maxDailyLossPercent: 5,
      maxWeeklyLossPercent: 10,
      dailyLossReferenceTry: 10000,
      weeklyLossReferenceTry: 10000,
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
    },
    metrics: {
      confidencePercent: candidate.confidence,
      spreadPercent: 0.1,
      liquidity24h: candidate.liquidity24h,
      expectedProfitPercent: candidate.expectedProfitPercent,
      slippagePercent: 0.15,
      volatilityPercent: 1.5,
      riskPerTradePercent: candidate.riskPerTradePercent,
      stopLossConfigured: true,
      aiRiskScore: candidate.riskScore,
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
  if (riskReasons.length > 0) return false;
  if (useQualityPolicy) {
    const entryQuality = shouldRejectHighRiskLowConfidenceEntry({
      confidencePercent: candidate.confidence,
      aiRiskScore: candidate.riskScore,
    });
    if (entryQuality.reject) return false;
  }
  return candidate.confidence >= 58;
}

function simulateExit(candidate: ReturnType<typeof buildTrade>, rand: () => number, useQualityPolicy: boolean) {
  const outcomeRand = rand();
  let exitPrice = candidate.entryPrice;
  let exitReason = "SIMULATED_HOLD";
  if (outcomeRand > 0.42) {
    exitPrice = round(candidate.takeProfit - rand() * (candidate.takeProfit - candidate.entryPrice) * 0.35, 2);
    exitReason = "TAKE_PROFIT";
  } else if (outcomeRand > 0.18) {
    const rrRatio =
      candidate.entryPrice > candidate.stopLoss
        ? (candidate.takeProfit - candidate.entryPrice) / (candidate.entryPrice - candidate.stopLoss)
        : 0;
    if (
      useQualityPolicy &&
      candidate.confidence >= TRADE_QUALITY_POLICY.minConfidenceForQualityTimeoutExit &&
      rrRatio >= TRADE_QUALITY_POLICY.minRewardRiskForQualityTimeoutExit
    ) {
      const towardTp = 0.12 + rand() * 0.28;
      exitPrice = round(candidate.entryPrice + (candidate.takeProfit - candidate.entryPrice) * towardTp, 2);
      exitReason = "TIMEOUT_QUALITY_EXIT";
    } else {
      exitPrice = round(candidate.entryPrice + (rand() - 0.45) * candidate.entryPrice * 0.01, 2);
      exitReason = "TIMEOUT";
    }
  } else {
    exitPrice = round(candidate.stopLoss + rand() * (candidate.entryPrice - candidate.stopLoss) * 0.4, 2);
    exitReason = "STOP_LOSS";
  }
  const pnlPct = round(((exitPrice - candidate.entryPrice) / candidate.entryPrice) * 100, 3);
  const pnlUsdt = round((candidate.positionSize * pnlPct) / 100, 4);
  return { pnlUsdt, exitReason };
}

function computeKpis(trades: SimTrade[]) {
  const accepted = trades.filter((t) => t.accepted);
  const wins = accepted.filter((t) => t.pnlUsdt > 0);
  const losses = accepted.filter((t) => t.pnlUsdt <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnlUsdt, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsdt, 0));
  const profitFactor = grossLoss > 0 ? round(grossProfit / grossLoss, 3) : grossProfit > 0 ? 999 : 0;
  const avgWin = wins.length ? round(grossProfit / wins.length, 4) : 0;
  const avgLoss = losses.length ? round(grossLoss / losses.length, 4) : 0;
  const pnls = accepted.map((t) => t.pnlUsdt);
  const expectancy = accepted.length ? round(pnls.reduce((a, b) => a + b, 0) / accepted.length, 4) : 0;
  const mean = expectancy;
  const variance = accepted.length ? pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / accepted.length : 0;
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
  const avgHoldProxy = accepted.length ? round(accepted.length * 1, 0) : 0;
  return {
    accepted: accepted.length,
    acceptanceRate: round((accepted.length / trades.length) * 100, 2),
    profitFactor,
    avgWin,
    avgLoss,
    riskRewardRatio: avgLoss > 0 ? round(avgWin / avgLoss, 3) : 0,
    sharpeRatio,
    sortinoRatio,
    maxDrawdown: round(maxDrawdown, 4),
    expectancy,
    avgHoldProxy,
    timeoutLosses: accepted.filter((t) => t.exitReason === "TIMEOUT" && t.pnlUsdt <= 0).length,
    timeoutQualityExits: accepted.filter((t) => t.exitReason === "TIMEOUT_QUALITY_EXIT").length,
  };
}

function runSimulation(useQualityPolicy: boolean) {
  const rand = rng(SEED);
  const trades: SimTrade[] = [];
  for (let i = 1; i <= TARGET; i += 1) {
    const candidate = buildTrade(rand, i);
    const accepted = passesGates(candidate, useQualityPolicy);
    if (!accepted) {
      trades.push({ ...candidate, accepted: false, pnlUsdt: 0, exitReason: "REJECTED" });
      continue;
    }
    const exit = simulateExit(candidate, rand, useQualityPolicy);
    trades.push({ ...candidate, accepted: true, ...exit });
  }
  return { trades, kpis: computeKpis(trades) };
}

const before = runSimulation(false);
const after = runSimulation(true);

console.log("=== Profit Factor Validation (seed 42001, n=100) ===\n");
console.log("| KPI | BEFORE | AFTER | Delta |");
console.log("| --- | ---: | ---: | ---: |");
const rows: Array<[string, number, number]> = [
  ["Accepted trades", before.kpis.accepted, after.kpis.accepted],
  ["Acceptance rate %", before.kpis.acceptanceRate, after.kpis.acceptanceRate],
  ["Profit Factor", before.kpis.profitFactor, after.kpis.profitFactor],
  ["Avg Win (USDT)", before.kpis.avgWin, after.kpis.avgWin],
  ["Avg Loss (USDT)", before.kpis.avgLoss, after.kpis.avgLoss],
  ["Risk/Reward", before.kpis.riskRewardRatio, after.kpis.riskRewardRatio],
  ["Sharpe", before.kpis.sharpeRatio, after.kpis.sharpeRatio],
  ["Sortino", before.kpis.sortinoRatio, after.kpis.sortinoRatio],
  ["Max Drawdown (USDT)", before.kpis.maxDrawdown, after.kpis.maxDrawdown],
  ["Expectancy (USDT)", before.kpis.expectancy, after.kpis.expectancy],
  ["Timeout losses", before.kpis.timeoutLosses, after.kpis.timeoutLosses],
  ["Timeout quality exits", before.kpis.timeoutQualityExits, after.kpis.timeoutQualityExits],
];
for (const [label, b, a] of rows) {
  const delta = round(a - b, 4);
  console.log(`| ${label} | ${b} | ${a} | ${delta >= 0 ? "+" : ""}${delta} |`);
}
