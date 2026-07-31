import type { AIAnalysisInput, AIAnalysisScorecard, AIConsensusResult } from "@/src/types/ai";
import { computeShortTermScore } from "@/src/server/ai/short-term-score.service";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((acc, x) => acc + x, 0) / values.length;
}

function resolveDirection(decision: AIConsensusResult["finalDecision"]) {
  if (decision === "BUY") return "BUY";
  if (decision === "SELL") return "SELL";
  return "WAIT";
}

function computeExpectedMovePercent(input: AIAnalysisInput, consensus: AIConsensusResult) {
  const currentPrice = input.lastPrice;
  const target = consensus.decisionPayload?.targetPrice ?? null;
  if (currentPrice > 0 && typeof target === "number" && target > 0) {
    if (consensus.finalDecision === "BUY") {
      return ((target - currentPrice) / currentPrice) * 100;
    }
    if (consensus.finalDecision === "SELL") {
      return ((currentPrice - target) / currentPrice) * 100;
    }
  }

  const momentum = Math.abs(Number(input.marketSignals?.shortMomentumPercent ?? 0));
  const volatility = Math.max(0, Number(input.volatility ?? 0));
  const regimeBoost = Number(input.marketRegime?.tpMultiplier ?? 1);
  const base = Math.max(momentum * 1.3, volatility * 0.9, 0.6);
  return base * regimeBoost;
}

function computeRiskLevel(input: AIAnalysisInput, consensus: AIConsensusResult) {
  const volatility = Number(input.volatility ?? 0);
  const fakeBreakoutRisk = Number(consensus.decisionPayload?.liquidityIntel?.fakeBreakoutRisk ?? 0);
  const regime = input.marketRegime?.mode ?? "RANGE_SIDEWAYS";
  if (volatility >= 2.4 || fakeBreakoutRisk >= 65 || regime === "HIGH_VOLATILITY_CHAOS") {
    return "HIGH";
  }
  if (volatility >= 1.6 || fakeBreakoutRisk >= 45 || regime === "NEWS_DRIVEN_UNSTABLE") {
    return "MEDIUM";
  }
  return "LOW";
}

function computeTimeHorizonMinutes(consensus: AIConsensusResult) {
  const duration = average(
    (consensus.outputs ?? [])
      .map((row) => Number(row.output?.estimatedDurationSec ?? 0))
      .filter((value) => Number.isFinite(value) && value > 0),
  );
  const seconds = duration > 0 ? duration : 240;
  const minutes = Math.round(seconds / 60);
  return Math.max(1, Math.min(180, minutes));
}

export function buildAnalysisScorecard(input: AIAnalysisInput, consensus: AIConsensusResult): AIAnalysisScorecard {
  const currentPrice = input.lastPrice;
  const direction = resolveDirection(consensus.finalDecision);
  const shortTermScore = computeShortTermScore(input, consensus);
  const expectedMovePercentRaw = computeExpectedMovePercent(input, consensus);
  const expectedMovePercent = Number(clamp(expectedMovePercentRaw, 0.4, 12).toFixed(4));
  const targetSellPercent = Number(clamp(expectedMovePercent * 1.05, 0.8, 10).toFixed(4));
  const initialStopPercent = Number(clamp(targetSellPercent * 0.45, 0.6, 6).toFixed(4));
  const trailingStartPercent = Number(clamp(targetSellPercent * 0.8, 0.6, 8).toFixed(4));
  const trailingGapPercent = Number(clamp(targetSellPercent * 0.25, 0.4, 4).toFixed(4));
  const expectedMoveRange = {
    min: Number((currentPrice * (1 - expectedMovePercent / 100)).toFixed(6)),
    max: Number((currentPrice * (1 + expectedMovePercent / 100)).toFixed(6)),
  };
  const reasons = [
    consensus.explanation,
    consensus.decisionPayload?.consensusEngine?.reasonedFinalReport,
    consensus.decisionPayload?.marketModeReason,
  ].filter((x): x is string => Boolean(x)).slice(0, 6);

  return {
    symbol: input.symbol,
    currentPrice,
    direction,
    confidenceScore: shortTermScore.total,
    strictScoreBreakdown: shortTermScore.breakdown,
    expectedMovePercent,
    expectedMoveRange,
    targetSellPercent,
    initialStopPercent,
    trailingStartPercent,
    trailingGapPercent,
    riskLevel: computeRiskLevel(input, consensus),
    reasons,
    invalidationReason: consensus.rejectReason ?? consensus.decisionPayload?.entryRejectReason ?? null,
    timeHorizonMinutes: computeTimeHorizonMinutes(consensus),
  };
}
