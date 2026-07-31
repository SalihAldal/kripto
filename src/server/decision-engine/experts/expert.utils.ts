import type { ExpertOpinionType } from "@prisma/client";
import type { ExpertOpinionResult } from "@/src/server/decision-engine/decision-engine.types";

export function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function scoreToOpinion(score: number, bullishBias = 0): ExpertOpinionType {
  const adjusted = score + bullishBias;
  if (adjusted >= 78) return "BUY";
  if (adjusted >= 62) return "WEAK_BUY";
  if (adjusted >= 42) return "HOLD";
  if (adjusted >= 28) return "WEAK_SELL";
  if (adjusted > 0) return "SELL";
  return "NO_OPINION";
}

export function buildExpertResult(input: Omit<ExpertOpinionResult, "confidence"> & { confidence?: number }): ExpertOpinionResult {
  const confidence = clampScore(input.confidence ?? input.score);
  return {
    ...input,
    confidence,
    score: clampScore(input.score),
    positiveFactors: input.positiveFactors.slice(0, 5),
    negativeFactors: input.negativeFactors.slice(0, 5),
    topRisks: input.topRisks.slice(0, 5),
  };
}

export function avg(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
