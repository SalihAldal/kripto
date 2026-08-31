import crypto from "node:crypto";

export type ShadowVerdict = "APPROVED" | "WAIT" | "REJECTED";
export type InteractionClass =
  | "SHARED_SIGNAL_DOUBLE_COUNT"
  | "DOWNSTREAM_PENALTY"
  | "INDEPENDENT_VALID_PENALTY"
  | "REGIME_DEPENDENT_INTERACTION"
  | "MOMENTUM_DUPLICATION"
  | "LEARNING_OVERWEIGHT"
  | "UNKNOWN";

export type ShadowInput = {
  candidateId: string;
  symbol: string;
  strategy: string;
  regime: string;
  technicalScore: number;
  momentumScore: number;
  sentimentScore: number;
  shortMomentum: number;
  shortFlow: number;
  confidence: number;
  learningScore: number;
  bullishCount: number;
  executionScore: number;
  expectedValue: number;
  firstBlockingCondition: string;
  blockingConditions: string[];
  baselineVerdict: ShadowVerdict;
};

export const SHADOW_POLICY = {
  technicalMin: 48,
  sentimentMin: 42,
  confidenceMinWait: 40,
  confidenceMinBuy: 62,
  momentumMinBuy: 60,
  executionMinBuy: 55,
  bullishMinBuy: 4,
  consensusMinBuy: 68,
  shortMomentumAbsMin: 0.08,
  shortFlowAbsMin: 0.03,
} as const;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function norm(n: number | null | undefined) {
  return Number.isFinite(n) ? Number(n) : Number.NaN;
}

export function computeMasterMetricsConfidence(consensusScore: number, agreementScore: number, conflictScore: number) {
  return clamp(consensusScore * 0.55 + agreementScore * 0.35 - conflictScore * 0.15, 0, 100);
}

export function computeBlendedConfidence(hybridConfidence: number, masterMetricsConfidence: number, conflictScore: number) {
  return clamp(hybridConfidence * 0.55 + masterMetricsConfidence * 0.45 - conflictScore * 0.08, 0, 100);
}

export function normalizeBlocker(raw: string) {
  const v = String(raw ?? "").toUpperCase();
  if (v.includes("LEARNING")) return "LEARNING";
  if (v.includes("MOMENTUM")) return "MOMENTUM";
  if (v.includes("TECHNICAL") || v.includes("MTF")) return "TECHNICAL";
  if (v.includes("CONFIDENCE")) return "CONFIDENCE";
  if (v.includes("RISK")) return "RISK";
  if (v.includes("REGIME")) return "REGIME";
  if (v.includes("EXECUTION")) return "EXECUTION";
  return "OTHER";
}

export function detectInteractionClass(input: ShadowInput): InteractionClass {
  const blocker = normalizeBlocker(input.firstBlockingCondition);
  const hasLearningBlock = blocker === "LEARNING" || input.blockingConditions.some((b) => normalizeBlocker(b) === "LEARNING");
  const momentumWeak =
    norm(input.momentumScore) < SHADOW_POLICY.momentumMinBuy &&
    Math.abs(norm(input.shortMomentum)) < SHADOW_POLICY.shortMomentumAbsMin &&
    Math.abs(norm(input.shortFlow)) < SHADOW_POLICY.shortFlowAbsMin;
  if (hasLearningBlock && momentumWeak) return "SHARED_SIGNAL_DOUBLE_COUNT";
  if (hasLearningBlock) return "LEARNING_OVERWEIGHT";
  if (momentumWeak) return "MOMENTUM_DUPLICATION";
  if (blocker === "REGIME") return "REGIME_DEPENDENT_INTERACTION";
  if (blocker === "CONFIDENCE") return "DOWNSTREAM_PENALTY";
  return "UNKNOWN";
}

export function baselineDecision(input: ShadowInput) {
  return {
    confidence: norm(input.confidence),
    verdict: input.baselineVerdict,
    firstBlocker: normalizeBlocker(input.firstBlockingCondition),
  };
}

export function correctionDecision(input: ShadowInput) {
  const interaction = detectInteractionClass(input);
  const momentumWeak =
    norm(input.momentumScore) < SHADOW_POLICY.momentumMinBuy &&
    Math.abs(norm(input.shortMomentum)) < SHADOW_POLICY.shortMomentumAbsMin &&
    Math.abs(norm(input.shortFlow)) < SHADOW_POLICY.shortFlowAbsMin;

  const interactionPenalty =
    interaction === "SHARED_SIGNAL_DOUBLE_COUNT"
      ? 6
      : interaction === "LEARNING_OVERWEIGHT"
        ? 4
        : interaction === "MOMENTUM_DUPLICATION"
          ? 3
          : 0;

  const correctedConfidence = clamp(norm(input.confidence) + interactionPenalty, 0, 100);
  const technicalFail = norm(input.technicalScore) < SHADOW_POLICY.technicalMin || norm(input.sentimentScore) < SHADOW_POLICY.sentimentMin;
  const buyGate =
    correctedConfidence >= SHADOW_POLICY.confidenceMinBuy &&
    norm(input.momentumScore) >= SHADOW_POLICY.momentumMinBuy &&
    norm(input.executionScore) >= SHADOW_POLICY.executionMinBuy &&
    norm(input.bullishCount) >= SHADOW_POLICY.bullishMinBuy &&
    norm(input.expectedValue) >= SHADOW_POLICY.consensusMinBuy;

  let verdict: ShadowVerdict = "WAIT";
  let firstBlocker = "CONFIDENCE";
  if (technicalFail) {
    verdict = "REJECTED";
    firstBlocker = "TECHNICAL";
  } else if (buyGate) {
    verdict = "APPROVED";
    firstBlocker = "NONE";
  } else if (correctedConfidence < SHADOW_POLICY.confidenceMinWait) {
    verdict = "REJECTED";
    firstBlocker = "CONFIDENCE";
  } else if (norm(input.momentumScore) < SHADOW_POLICY.momentumMinBuy) {
    verdict = "WAIT";
    firstBlocker = "MOMENTUM";
  } else if (norm(input.executionScore) < SHADOW_POLICY.executionMinBuy) {
    verdict = "WAIT";
    firstBlocker = "EXECUTION";
  }

  return {
    interactionClass: interaction,
    interactionPenalty,
    confidence: correctedConfidence,
    verdict,
    firstBlocker,
  };
}

export function buildInputHash(input: ShadowInput) {
  const payload = {
    candidateId: input.candidateId,
    symbol: input.symbol,
    strategy: input.strategy,
    regime: input.regime,
    technicalScore: norm(input.technicalScore),
    momentumScore: norm(input.momentumScore),
    sentimentScore: norm(input.sentimentScore),
    shortMomentum: norm(input.shortMomentum),
    shortFlow: norm(input.shortFlow),
    confidence: norm(input.confidence),
    learningScore: norm(input.learningScore),
    bullishCount: norm(input.bullishCount),
    executionScore: norm(input.executionScore),
    expectedValue: norm(input.expectedValue),
    firstBlockingCondition: normalizeBlocker(input.firstBlockingCondition),
    blockingConditions: input.blockingConditions.map(normalizeBlocker).sort(),
    baselineVerdict: input.baselineVerdict,
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

