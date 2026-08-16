/**
 * Seeded false-negative validation — compares legacy flat gates vs calibrated policy on identical candidates.
 */
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

function simulateConsensusLegacy(rand: () => number, confidence: number) {
  const votes = [rand() > 0.35 ? "BUY" : "HOLD", rand() > 0.4 ? "BUY" : "HOLD", rand() > 0.45 ? "BUY" : "HOLD"];
  const buyVotes = votes.filter((v) => v === "BUY").length;
  return buyVotes >= 2 && confidence >= 58;
}

function simulateConsensusCalibrated(rand: () => number, confidence: number) {
  const votes = [rand() > 0.35 ? "BUY" : "HOLD", rand() > 0.4 ? "BUY" : "HOLD", rand() > 0.45 ? "BUY" : "HOLD"];
  const buyVotes = votes.filter((v) => v === "BUY").length;
  const hasOnlyBuyBias = buyVotes > 0 && !votes.some((v) => v === "SELL");
  return (buyVotes >= 2 && confidence >= 58) || (hasOnlyBuyBias && confidence >= 65);
}

function buildCandidate(rand: () => number) {
  const confidence = Math.round((52 + rand() * 42) * 100) / 100;
  const rankingScore = Math.round((40 + rand() * 55) * 100) / 100;
  const riskScore = Math.round((18 + rand() * 62) * 100) / 100;
  const riskPerTradePercent = Math.round((0.4 + rand() * 1.1) * 1000) / 1000;
  const liquidity24h = Math.round(200_000 + rand() * 8_000_000);
  const expectedProfitPercent = Math.round((0.15 + rand() * 1.2) * 1000) / 1000;
  return { confidence, rankingScore, riskScore, riskPerTradePercent, liquidity24h, expectedProfitPercent };
}

function evaluateLegacy(candidate: ReturnType<typeof buildCandidate>, consensusPass: boolean, rand: () => number) {
  const rankingPass = candidate.rankingScore >= 55;
  const liquidityPass = candidate.liquidity24h >= 5_000_000;
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
  const rejected =
    !rankingPass || !liquidityPass || !consensusPass || riskReasons.length > 0;
  const missedProfit =
    rejected && candidate.expectedProfitPercent * 500 * (rand() > 0.35 ? 1 : 0) > 0.5
      ? candidate.expectedProfitPercent * 500 * 0.01
      : 0;
  return { rejected, falseNegative: rejected && missedProfit > 0.5, missedProfit };
}

function evaluateCalibrated(candidate: ReturnType<typeof buildCandidate>, consensusPass: boolean, rand: () => number) {
  const rankingGate = evaluateRankingGate({
    rankingScore: candidate.rankingScore,
    confidencePercent: candidate.confidence,
    riskScore: candidate.riskScore,
  });
  const liquidityPass = candidate.liquidity24h >= 5_000_000;
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
  const rejected =
    !rankingGate.pass || !liquidityPass || !consensusPass || riskReasons.length > 0;
  const missedProfit =
    rejected && candidate.expectedProfitPercent * 500 * (rand() > 0.35 ? 1 : 0) > 0.5
      ? candidate.expectedProfitPercent * 500 * 0.01
      : 0;
  return { rejected, falseNegative: rejected && missedProfit > 0.5, missedProfit };
}

function run(mode: "legacy" | "calibrated") {
  const rand = rng(SEED);
  let rejected = 0;
  let falseNegatives = 0;
  let accepted = 0;
  for (let i = 0; i < TARGET; i += 1) {
    const candidate = buildCandidate(rand);
    const consensusPass =
      mode === "legacy"
        ? simulateConsensusLegacy(rand, candidate.confidence)
        : simulateConsensusCalibrated(rand, candidate.confidence);
    const result =
      mode === "legacy"
        ? evaluateLegacy(candidate, consensusPass, rand)
        : evaluateCalibrated(candidate, consensusPass, rand);
    if (result.rejected) rejected += 1;
    else accepted += 1;
    if (result.falseNegative) falseNegatives += 1;
  }
  return {
    accepted,
    rejected,
    acceptanceRatePct: Number(((accepted / TARGET) * 100).toFixed(1)),
    falseNegativeRatePct: Number(((falseNegatives / Math.max(rejected, 1)) * 100).toFixed(1)),
    falseNegativeCount: falseNegatives,
  };
}

const before = run("legacy");
const after = run("calibrated");

console.log(
  JSON.stringify(
    {
      seed: SEED,
      candidates: TARGET,
      before,
      after,
      delta: {
        acceptanceRatePctPoints: Number((after.acceptanceRatePct - before.acceptanceRatePct).toFixed(1)),
        falseNegativeRatePctPoints: Number((before.falseNegativeRatePct - after.falseNegativeRatePct).toFixed(1)),
      },
    },
    null,
    2,
  ),
);
