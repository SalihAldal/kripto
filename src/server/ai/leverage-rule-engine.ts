import { env } from "@/lib/config";
import type { AIConsensusResult } from "@/src/types/ai";

export type LeverageRuleInput = {
  platform: "tr" | "global";
  executionMode: "live" | "paper" | "dry-run";
  consensus: AIConsensusResult;
  spreadPercent: number;
  volatilityPercent: number;
  expectedMovePercent: number;
  trendAgreementScore: number;
  requestedMaxLeverage: number;
};

export type LeverageRuleOutput = {
  suggestedLeverage: number;
  maxAllowedLeverage: number;
  profile: "ULTRA_CONSERVATIVE" | "CONSERVATIVE" | "MODERATE" | "AGGRESSIVE";
  canAutoExecute: boolean;
  route: "SPOT_FALLBACK" | "LEVERAGE_DISABLED" | "LEVERAGE_EXECUTION";
  reasons: string[];
  riskBand: "LOW" | "MEDIUM" | "HIGH";
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalize(num: number, min: number, max: number) {
  if (!Number.isFinite(num)) return 0;
  if (max <= min) return 0;
  return clamp((num - min) / (max - min), 0, 1);
}

function toProfile(leverage: number): LeverageRuleOutput["profile"] {
  if (leverage <= 1) return "ULTRA_CONSERVATIVE";
  if (leverage <= 2) return "CONSERVATIVE";
  if (leverage <= 4) return "MODERATE";
  return "AGGRESSIVE";
}

function toRiskBand(input: LeverageRuleInput): LeverageRuleOutput["riskBand"] {
  const risk = input.consensus.finalRiskScore;
  if (risk >= 68 || input.volatilityPercent >= 2.8 || input.spreadPercent >= 0.22) return "HIGH";
  if (risk >= 52 || input.volatilityPercent >= 1.9 || input.spreadPercent >= 0.12) return "MEDIUM";
  return "LOW";
}

function hasUnanimousDirectionalConsensus(consensus: AIConsensusResult) {
  const decision = consensus.finalDecision;
  if (decision !== "BUY" && decision !== "SELL") return false;
  const valid = consensus.outputs
    .filter((x) => x.ok && x.output)
    .map((x) => x.output!.decision);
  if (valid.length < 3) return false;
  return valid.every((x) => x === decision);
}

export function evaluateLeverageRules(input: LeverageRuleInput): LeverageRuleOutput {
  const isEliteQuality = env.AI_QUALITY_PROFILE === "elite";
  const reasons: string[] = [];
  const cappedMax = clamp(Math.floor(input.requestedMaxLeverage || 1), 1, 20);
  const direction = input.consensus.finalDecision;
  const riskBand = toRiskBand(input);

  if (direction !== "BUY" && direction !== "SELL") {
    reasons.push("Directional signal not strong enough for leverage.");
    return {
      suggestedLeverage: 1,
      maxAllowedLeverage: 1,
      profile: "ULTRA_CONSERVATIVE",
      canAutoExecute: false,
      route: "LEVERAGE_DISABLED",
      reasons,
      riskBand,
    };
  }

  if (input.platform === "tr") {
    reasons.push("BinanceTR flow is configured for spot execution.");
    reasons.push("Leverage output is advisory; execution falls back to spot all-balance flow.");
    return {
      suggestedLeverage: 1,
      maxAllowedLeverage: 1,
      profile: "ULTRA_CONSERVATIVE",
      canAutoExecute: false,
      route: "SPOT_FALLBACK",
      reasons,
      riskBand,
    };
  }

  if (env.EXECUTION_MODE !== "live") {
    reasons.push("Live execution mode is disabled; leverage execution stays advisory.");
  }

  const confidence = clamp(input.consensus.finalConfidence, 0, 100);
  const riskScore = clamp(input.consensus.finalRiskScore, 0, 100);
  const spread = Math.max(0, input.spreadPercent);
  const volatility = Math.max(0, input.volatilityPercent);
  const expectedMove = Math.max(0, input.expectedMovePercent);
  const trendAgreement = clamp(input.trendAgreementScore, 0, 1);
  const unanimousDirectional = hasUnanimousDirectionalConsensus(input.consensus);

  if (env.AI_ULTRA_PRECISION_MODE) {
    if (confidence < env.AI_LEVERAGE_MIN_CONFIDENCE_ULTRA) {
      reasons.push(`Ultra precision gate: confidence < ${env.AI_LEVERAGE_MIN_CONFIDENCE_ULTRA}.`);
    }
    if (riskScore > env.AI_ULTRA_MAX_RISK_SCORE_LEVERAGE) {
      reasons.push(`Ultra precision gate: risk > ${env.AI_ULTRA_MAX_RISK_SCORE_LEVERAGE}.`);
    }
    if (trendAgreement < env.AI_ULTRA_MIN_TREND_AGREEMENT) {
      reasons.push(`Ultra precision gate: trend agreement < ${env.AI_ULTRA_MIN_TREND_AGREEMENT}.`);
    }
    if (!unanimousDirectional) {
      reasons.push("Ultra precision gate: provider kararlarinda tam yon birligi yok.");
    }
    if (spread >= (isEliteQuality ? 0.07 : 0.1)) {
      reasons.push("Ultra precision gate: spread fazla.");
    }
    if (volatility >= (isEliteQuality ? 1.4 : 2)) {
      reasons.push("Ultra precision gate: volatilite fazla.");
    }
    if (expectedMove < (isEliteQuality ? 1.8 : 1.2)) {
      reasons.push("Ultra precision gate: beklenen hareket yetersiz.");
    }
    if (reasons.some((x) => x.startsWith("Ultra precision gate:"))) {
      return {
        suggestedLeverage: 1,
        maxAllowedLeverage: 1,
        profile: "ULTRA_CONSERVATIVE",
        canAutoExecute: false,
        route: "LEVERAGE_DISABLED",
        reasons,
        riskBand,
      };
    }
  }

  const confidenceScore = normalize(confidence, 52, 90);
  const riskScoreNorm = 1 - normalize(riskScore, 40, 82);
  const spreadScore = 1 - normalize(spread, 0.05, 0.28);
  const volatilityScore = 1 - normalize(volatility, 0.8, 3.2);
  const moveScore = normalize(expectedMove, 0.8, 4.8);

  const qualityScore =
    confidenceScore * 0.34 +
    riskScoreNorm * 0.28 +
    spreadScore * 0.12 +
    volatilityScore * 0.1 +
    moveScore * 0.1 +
    trendAgreement * 0.06;

  let softCap = cappedMax;
  if (riskBand === "HIGH") softCap = Math.min(softCap, 2);
  if (riskBand === "MEDIUM") softCap = Math.min(softCap, 4);
  if (confidence < (env.AI_ULTRA_PRECISION_MODE ? env.AI_LEVERAGE_MIN_CONFIDENCE_ULTRA : 60)) softCap = Math.min(softCap, 2);
  if (trendAgreement < 0.34) softCap = Math.min(softCap, 2);
  if (spread >= 0.22) softCap = 1;

  const rawLeverage = 1 + (softCap - 1) * clamp(qualityScore, 0, 1);
  const suggestedLeverage = clamp(Math.floor(rawLeverage), 1, softCap);

  if (suggestedLeverage <= 1) {
    reasons.push("Risk/quality gates suggest staying near 1x.");
  } else {
    reasons.push(`Quality gates allow controlled leverage up to ${suggestedLeverage}x.`);
  }
  reasons.push(`Confidence=${confidence.toFixed(2)} Risk=${riskScore.toFixed(2)} Spread=${spread.toFixed(4)} Vol=${volatility.toFixed(4)}.`);

  return {
    suggestedLeverage,
    maxAllowedLeverage: softCap,
    profile: toProfile(suggestedLeverage),
    canAutoExecute: env.EXECUTION_MODE === "live" && softCap > 1,
    route: softCap > 1 ? "LEVERAGE_EXECUTION" : "LEVERAGE_DISABLED",
    reasons,
    riskBand,
  };
}

