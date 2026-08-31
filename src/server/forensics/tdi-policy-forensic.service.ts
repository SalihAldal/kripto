import type { TdiDecisionRecord } from "@/src/server/forensics/forensic.types";

export type TechnicalBlockClassification =
  | "TECHNICAL_POLICY_CORRECT"
  | "TECHNICAL_CALCULATION_BUG"
  | "TECHNICAL_NORMALIZATION_BUG"
  | "TECHNICAL_REGIME_BUG"
  | "TECHNICAL_DUPLICATE_GATE"
  | "TECHNICAL_DATA_PROBLEM"
  | "UNKNOWN";

export type MomentumBlockClassification =
  | "MOMENTUM_POLICY_CORRECT"
  | "MOMENTUM_CALCULATION_BUG"
  | "MOMENTUM_NORMALIZATION_BUG"
  | "MOMENTUM_UNIT_BUG"
  | "MOMENTUM_REGIME_BUG"
  | "MOMENTUM_DUPLICATE_GATE"
  | "MOMENTUM_DATA_PROBLEM"
  | "UNKNOWN";

export type RuntimeRegressionClass = "NONE" | "TRANSIENT" | "REGRESSION" | "UNRESOLVED";

export type GateReplayResult = {
  technicalPass: boolean;
  momentumPass: boolean;
  sentimentPass: boolean;
  confidencePass: boolean;
  bullishCountPass: boolean;
  executionPass: boolean;
  masterPass: boolean;
  finalBuy: boolean;
  firstFailedGate:
    | "technical"
    | "momentum"
    | "sentiment"
    | "confidence"
    | "bullishCount"
    | "execution"
    | "master"
    | "finalTdi"
    | "none";
};

export function technicalThreshold(row: TdiDecisionRecord) {
  return Number(row.thresholds?.technicalMinScore ?? 55);
}

export function momentumThreshold(row: TdiDecisionRecord) {
  return Number(row.thresholds?.sentimentMinScore ?? 50);
}

export function confidenceThreshold(row: TdiDecisionRecord) {
  return Number(row.thresholds?.confidenceMinScore ?? (row.paperRelaxed ? 25 : 55));
}

export function isLowMomentumInput(row: TdiDecisionRecord) {
  const shortMomentum = Number(row.shortMomentum ?? NaN);
  const shortFlow = Number(row.shortFlow ?? NaN);
  if (!Number.isFinite(shortMomentum) || !Number.isFinite(shortFlow)) return true;
  return Math.abs(shortMomentum) < 0.08 && Math.abs(shortFlow) < 0.03;
}

export function classifyTechnicalBlock(row: TdiDecisionRecord): TechnicalBlockClassification {
  const score = Number(row.technicalScore ?? NaN);
  const threshold = technicalThreshold(row);
  const delta = Number(row.regimeDelta?.technical ?? 0);
  if ((row.dataQualityIssues ?? []).some((issue) => issue.includes("TECHNICAL"))) return "TECHNICAL_DATA_PROBLEM";
  if (!Number.isFinite(score) || !Number.isFinite(threshold)) return "TECHNICAL_DATA_PROBLEM";
  if (score < 0 || score > 100 || threshold < 0 || threshold > 100) return "TECHNICAL_NORMALIZATION_BUG";
  if (!Number.isFinite(delta) || Math.abs(delta) > 40) return "TECHNICAL_REGIME_BUG";
  if (score >= threshold && row.firstBlockingCondition === "TECHNICAL") return "TECHNICAL_DUPLICATE_GATE";
  if (score < threshold && row.firstBlockingCondition === "TECHNICAL") return "TECHNICAL_POLICY_CORRECT";
  if (row.firstBlockingCondition === "TECHNICAL") return "UNKNOWN";
  return "UNKNOWN";
}

export function classifyMomentumBlock(row: TdiDecisionRecord): MomentumBlockClassification {
  const mScore = Number(row.momentumScore ?? NaN);
  const sScore = Number(row.sentimentScore ?? NaN);
  const threshold = momentumThreshold(row);
  const delta = Number(row.regimeDelta?.sentiment ?? 0);
  const shortMomentum = Number(row.shortMomentum ?? NaN);
  const shortFlow = Number(row.shortFlow ?? NaN);
  const lowMomentum = isLowMomentumInput(row);
  if ((row.dataQualityIssues ?? []).some((issue) => issue.includes("MOMENTUM"))) return "MOMENTUM_DATA_PROBLEM";
  if (!Number.isFinite(mScore) || !Number.isFinite(sScore) || !Number.isFinite(threshold)) return "MOMENTUM_DATA_PROBLEM";
  if (!Number.isFinite(shortMomentum) || !Number.isFinite(shortFlow)) return "MOMENTUM_DATA_PROBLEM";
  if (shortFlow < -1 || shortFlow > 1 || shortMomentum < -25 || shortMomentum > 25) return "MOMENTUM_UNIT_BUG";
  if (!Number.isFinite(delta) || Math.abs(delta) > 40) return "MOMENTUM_REGIME_BUG";
  if (sScore < 0 || sScore > 100 || threshold < 0 || threshold > 100) return "MOMENTUM_NORMALIZATION_BUG";
  if (row.firstBlockingCondition === "MOMENTUM" && sScore >= threshold && lowMomentum) return "MOMENTUM_DUPLICATE_GATE";
  if (row.firstBlockingCondition === "MOMENTUM" && (sScore < threshold || lowMomentum)) return "MOMENTUM_POLICY_CORRECT";
  if (row.firstBlockingCondition === "MOMENTUM") return "UNKNOWN";
  return "UNKNOWN";
}

export function replayGateSequence(row: TdiDecisionRecord): GateReplayResult {
  const technicalPass = Number(row.technicalScore ?? -1) >= technicalThreshold(row);
  const sentimentPass = Number(row.sentimentScore ?? -1) >= momentumThreshold(row);
  const momentumPass = sentimentPass && !isLowMomentumInput(row);
  const confidencePass = Number(row.confidence ?? -1) >= confidenceThreshold(row);
  const bullishReq = row.paperRelaxed ? 1 : 2;
  const bullishCountPass = Number(row.bullishCount ?? 0) >= bullishReq;
  const executionFloor = row.paperRelaxed ? 35 : 45;
  const executionScore = Number(row.executionScore ?? executionFloor);
  const executionPass = executionScore >= executionFloor;
  const masterPass = ["BUY", "STRONG_BUY", "WAIT", "WATCHLIST"].includes(String(row.masterDecision ?? row.hybridDecision ?? "").toUpperCase());
  const finalBuy = row.verdict === "APPROVED" || String(row.finalDecision ?? "").toUpperCase() === "BUY";
  const firstFailedGate =
    !technicalPass ? "technical" :
    !momentumPass ? "momentum" :
    !sentimentPass ? "sentiment" :
    !confidencePass ? "confidence" :
    !bullishCountPass ? "bullishCount" :
    !executionPass ? "execution" :
    !masterPass ? "master" :
    !finalBuy ? "finalTdi" : "none";
  return {
    technicalPass,
    momentumPass,
    sentimentPass,
    confidencePass,
    bullishCountPass,
    executionPass,
    masterPass,
    finalBuy,
    firstFailedGate,
  };
}

export function classifyRuntimeRegression(input: {
  previousTimeoutCount: number;
  latestTimeoutCount: number;
  latestP99: number;
  previousP99: number;
}): RuntimeRegressionClass {
  if (input.latestTimeoutCount <= 0) return "NONE";
  if (input.latestTimeoutCount === 1 && input.latestP99 <= Math.max(input.previousP99 * 1.2, 14_500)) return "TRANSIENT";
  if (input.latestTimeoutCount > input.previousTimeoutCount && input.latestP99 > input.previousP99 * 1.2) return "REGRESSION";
  return "UNRESOLVED";
}

