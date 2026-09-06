import { evaluateEarlyAccelerationStrategy } from "@/src/server/profitability/pr02-early-evaluator";
import { evaluateBreakoutRetestStrategy } from "@/src/server/profitability/pr03-breakout-evaluator";
import { evaluateMomentumContinuationStrategy } from "@/src/server/profitability/pr03-momentum-evaluator";

export type MarketRegime =
  | "BULL_TREND"
  | "BEAR_TREND"
  | "RANGE_SIDEWAYS"
  | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY"
  | "ROCKET_PUMP"
  | "CHOP"
  | "TRANSITION"
  | "UNKNOWN";

export type RegimeSnapshot = {
  regime: MarketRegime;
  confidence: number;
  transitionProbability: number;
  chaosProbability: number;
  detectedAt: string;
  marketEventAt: string;
  evidence: string[];
  missingData: string[];
  policyVersion: string;
};

export type StrategyId =
  | "EARLY_ACCELERATION"
  | "MOMENTUM_CONTINUATION"
  | "BREAKOUT_RETEST"
  | "STEADY_TREND"
  | "RANGE_MEAN_REVERSION";

export type StrategyEvaluation = {
  evaluationId: string;
  candidateId: string;
  strategyId: StrategyId;
  policyVersion: string;
  sourceType: "LIVE_MARKET" | "RECORDED_REPLAY" | "SYNTHETIC_FIXTURE" | "UNKNOWN";
  evaluatedAt: string;
  marketEventAt: string;
  verdict: "ELIGIBLE" | "WAIT" | "INELIGIBLE";
  regimeCompatibility: number;
  setupQuality: number;
  entryTimingQuality: number;
  executionQuality: number;
  estimatedCostPercent: number;
  minimumViableMovePercent: number;
  reasons: string[];
  firstBlocker: string | null;
  missingFeatures: string[];
  staleFeatures: string[];
  invalidFeatures: string[];
  entryTrigger: string;
  invalidationReason: string | null;
  suggestedHorizon: string;
  suggestedRiskProfile: string;
  suggestedExitProfile: string;
  shadowOnly: true;
};

export type StrategyRouterResult = {
  candidateId: string;
  evaluations: StrategyEvaluation[];
  eligibleStrategies: StrategyId[];
  preferredStrategy: StrategyId | null;
  conflictStatus: "NO_CONFLICT" | "MULTIPLE_COMPATIBLE" | "CONTRADICTORY" | "INSUFFICIENT_DATA";
  shadowOnly: true;
};

export type StrategyInput = {
  candidateId: string;
  sourceType: StrategyEvaluation["sourceType"];
  marketEventAt: string;
  evaluatedAt: string;
  velocity: number;
  acceleration: number;
  volumeAcceleration: number;
  relativeStrength: number;
  spreadBps: number;
  liquidityScore: number;
  exhaustion: number;
  momentum: number;
  retracement: number;
  breakoutHeld: boolean;
  rangeScore: number;
  distanceFromMean: number;
  flowRecovery: number;
  flowImbalance?: number;
  tradeRateAcceleration?: number;
  priceReturnShortPct?: number;
  extensionFromBaselinePct?: number;
  staleFeatures?: string[];
  missingFeatures?: string[];
  invalidFeatures?: string[];
  entrySpread: number;
  entrySlippage: number;
  entryFee: number;
  exitSpread: number;
  exitSlippage: number;
  exitFee: number;
  strategyProfitBuffer: number;
  expectedMovePercent: number;
  earlyContext?: import("@/src/server/profitability/pr02-types").EarlyContextExtension;
  strategyContext?: import("@/src/server/profitability/pr03-types").StrategyContextExtension;
};

const STRATEGIES: StrategyId[] = [
  "EARLY_ACCELERATION",
  "MOMENTUM_CONTINUATION",
  "BREAKOUT_RETEST",
  "STEADY_TREND",
  "RANGE_MEAN_REVERSION",
];

export function evaluateCanonicalRegime(input: {
  marketEventAt: string;
  detectedAt: string;
  trend: number;
  volatility: number;
  momentum: number;
  transitionProbability: number;
  chaosProbability: number;
  pumpScore: number;
}): RegimeSnapshot {
  const evidence: string[] = [];
  let regime: MarketRegime = "UNKNOWN";
  if (input.chaosProbability > 0.75) {
    regime = "CHOP";
    evidence.push("high-chaos");
  } else if (input.pumpScore > 0.8 && input.momentum > 0.6) {
    regime = "ROCKET_PUMP";
    evidence.push("rocket-pump");
  } else if (input.transitionProbability > 0.7) {
    regime = "TRANSITION";
    evidence.push("transition-risk");
  } else if (input.volatility > 0.7) {
    regime = "HIGH_VOLATILITY";
    evidence.push("high-volatility");
  } else if (Math.abs(input.trend) < 0.15 && input.volatility < 0.3) {
    regime = "RANGE_SIDEWAYS";
    evidence.push("range-stability");
  } else if (input.trend > 0.4 && input.momentum > 0.2) {
    regime = "BULL_TREND";
    evidence.push("bull-trend");
  } else if (input.trend < -0.4 && input.momentum < -0.2) {
    regime = "BEAR_TREND";
    evidence.push("bear-trend");
  } else if (input.volatility < 0.35) {
    regime = "LOW_VOLATILITY";
    evidence.push("low-volatility");
  }
  return {
    regime,
    confidence: clamp01(Math.abs(input.trend) * 0.4 + Math.abs(input.momentum) * 0.3 + (1 - input.chaosProbability) * 0.3),
    transitionProbability: clamp01(input.transitionProbability),
    chaosProbability: clamp01(input.chaosProbability),
    detectedAt: input.detectedAt,
    marketEventAt: input.marketEventAt,
    evidence,
    missingData: [],
    policyVersion: "p4-regime-v1",
  };
}

export function evaluateStrategies(input: StrategyInput, regime: RegimeSnapshot): StrategyEvaluation[] {
  return STRATEGIES.map((strategyId) => evaluateOneStrategy(strategyId, input, regime));
}

export function routeStrategies(input: StrategyInput, regime: RegimeSnapshot): StrategyRouterResult {
  const evaluations = evaluateStrategies(input, regime);
  const eligible = evaluations.filter((row) => row.verdict === "ELIGIBLE");
  const missingOrStale = evaluations.some((row) => row.missingFeatures.length > 0 || row.staleFeatures.length > 0);
  if (!eligible.length) {
    return {
      candidateId: input.candidateId,
      evaluations,
      eligibleStrategies: [],
      preferredStrategy: null,
      conflictStatus: missingOrStale ? "INSUFFICIENT_DATA" : "NO_CONFLICT",
      shadowOnly: true,
    };
  }
  const trendEligible = eligible.some((row) =>
    row.strategyId === "EARLY_ACCELERATION" ||
    row.strategyId === "MOMENTUM_CONTINUATION" ||
    row.strategyId === "BREAKOUT_RETEST" ||
    row.strategyId === "STEADY_TREND",
  );
  const mrEligible = eligible.some((row) => row.strategyId === "RANGE_MEAN_REVERSION");
  const conflictStatus = trendEligible && mrEligible ? "CONTRADICTORY" : eligible.length > 1 ? "MULTIPLE_COMPATIBLE" : "NO_CONFLICT";
  const preferred = [...eligible].sort((a, b) => scoreEvaluation(b) - scoreEvaluation(a))[0] ?? null;
  return {
    candidateId: input.candidateId,
    evaluations,
    eligibleStrategies: eligible.map((row) => row.strategyId),
    preferredStrategy: preferred?.strategyId ?? null,
    conflictStatus,
    shadowOnly: true,
  };
}

export function computeMinimumViableMove(input: Pick<StrategyInput, "entrySpread" | "entrySlippage" | "entryFee" | "exitSpread" | "exitSlippage" | "exitFee" | "strategyProfitBuffer">): number {
  return Number((
    input.entrySpread +
    input.entrySlippage +
    input.entryFee +
    input.exitSpread +
    input.exitSlippage +
    input.exitFee +
    input.strategyProfitBuffer
  ).toFixed(6));
}

export function walkForwardSplit<T extends { eventAtMs: number; lifecycleId: string; labelEndAtMs?: number }>(rows: T[], embargoMs: number): {
  train: T[];
  validation: T[];
  test: T[];
} {
  const sorted = [...rows].sort((a, b) => a.eventAtMs - b.eventAtMs);
  const grouped = new Map<string, T[]>();
  for (const row of sorted) {
    const arr = grouped.get(row.lifecycleId) ?? [];
    arr.push(row);
    grouped.set(row.lifecycleId, arr);
  }
  const groups = [...grouped.values()].sort((a, b) => a[0]!.eventAtMs - b[0]!.eventAtMs);
  const n = groups.length;
  const trainEnd = Math.floor(n * 0.6);
  const valEnd = Math.floor(n * 0.8);
  const trainGroups = groups.slice(0, trainEnd);
  const validationGroups = groups.slice(trainEnd, valEnd);
  const testGroups = groups.slice(valEnd);
  const train = trainGroups.flat();
  const maxTrainLabelEnd = train.length
    ? Math.max(...train.map((row) => row.labelEndAtMs ?? row.eventAtMs))
    : Number.NEGATIVE_INFINITY;
  const validation = validationGroups.flat().filter((row) => row.eventAtMs >= maxTrainLabelEnd + embargoMs);
  const maxValidationLabelEnd = validation.length
    ? Math.max(...validation.map((row) => row.labelEndAtMs ?? row.eventAtMs))
    : maxTrainLabelEnd;
  const test = testGroups.flat().filter((row) => row.eventAtMs >= maxValidationLabelEnd + embargoMs);
  return { train, validation, test };
}

export function runNegativeControlLabelShuffle(
  winRate: number,
  shuffledWinRate: number,
): "FAIL" | "NOT_IMPLEMENTED" {
  if (!Number.isFinite(winRate) || !Number.isFinite(shuffledWinRate)) return "NOT_IMPLEMENTED";
  if (shuffledWinRate > winRate + 0.05) return "FAIL";
  return "NOT_IMPLEMENTED";
}

export function evaluateMultipleTesting(input: { experimentCount: number; parameterCount: number; variantCount: number; rawPValue: number }) {
  if (!Number.isFinite(input.rawPValue) || input.rawPValue < 0 || input.rawPValue > 1) {
    return {
      comparisons: Math.max(1, input.experimentCount * input.parameterCount * input.variantCount),
      correctedPValue: null,
      significantAfterCorrection: false,
      status: "INVALID_P_VALUE" as const,
    };
  }
  const comparisons = Math.max(1, input.experimentCount * input.parameterCount * input.variantCount);
  const corrected = Math.min(1, input.rawPValue * comparisons);
  return {
    comparisons,
    correctedPValue: Number(corrected.toFixed(6)),
    significantAfterCorrection: corrected < 0.05,
    status: "OK" as const,
  };
}

function evaluateOneStrategy(strategyId: StrategyId, input: StrategyInput, regime: RegimeSnapshot): StrategyEvaluation {
  if (strategyId === "EARLY_ACCELERATION") {
    return evaluateEarlyAccelerationStrategy(input, regime, input.earlyContext).strategyEvaluation;
  }
  if (strategyId === "MOMENTUM_CONTINUATION") {
    return evaluateMomentumContinuationStrategy(input, regime, input.strategyContext).strategyEvaluation;
  }
  if (strategyId === "BREAKOUT_RETEST") {
    return evaluateBreakoutRetestStrategy(input, regime, input.strategyContext).strategyEvaluation;
  }
  const reasons: string[] = [];
  const missingAll = new Set(input.missingFeatures ?? []);
  const staleAll = new Set(input.staleFeatures ?? []);
  const invalidAll = new Set(input.invalidFeatures ?? []);
  const commonRequired = [
    "expectedMovePercent",
    "entrySpread",
    "entrySlippage",
    "entryFee",
    "exitSpread",
    "exitSlippage",
    "exitFee",
    "liquidityScore",
    "marketEventAt",
  ];
  const perStrategyRequired: Record<StrategyId, string[]> = {
    EARLY_ACCELERATION: ["velocity", "acceleration", "volumeAcceleration", "relativeStrength"],
    MOMENTUM_CONTINUATION: ["momentum", "acceleration", "flowRecovery"],
    BREAKOUT_RETEST: ["breakoutHeld", "flowRecovery", "acceleration"],
    STEADY_TREND: ["relativeStrength", "exhaustion", "spreadBps"],
    RANGE_MEAN_REVERSION: ["rangeScore", "distanceFromMean", "flowRecovery", "retracement"],
  };
  const required = [...commonRequired, ...perStrategyRequired[strategyId]];
  const missingFeatures = required.filter((key) => missingAll.has(key));
  const staleFeatures = required.filter((key) => staleAll.has(key));
  const invalidFeatures = required.filter((key) => invalidAll.has(key));
  const minimumViableMovePercent = computeMinimumViableMove(input);
  const regimeCompatibility = regimeScore(strategyId, regime.regime);
  const setupQuality = setupScore(strategyId, input);
  const entryTimingQuality = entryTimingScore(strategyId, input);
  const executionQuality = execQualityScore(input);
  const estimatedCostPercent = minimumViableMovePercent - input.strategyProfitBuffer;
  if (missingFeatures.length > 0) reasons.push("MISSING_FEATURES");
  if (staleFeatures.length > 0) reasons.push("STALE_FEATURES");
  if (invalidFeatures.length > 0) reasons.push("INVALID_FEATURES");
  if (input.expectedMovePercent <= minimumViableMovePercent) reasons.push("COST_NOT_VIABLE");
  if (regimeCompatibility < 0.35) reasons.push("REGIME_MISMATCH");
  if (setupQuality < 0.45) reasons.push("SETUP_WEAK");
  if (entryTimingQuality < 0.4) reasons.push("ENTRY_TIMING_WEAK");
  if (executionQuality < 0.45) reasons.push("EXECUTION_QUALITY_WEAK");
  const verdict = resolveVerdict(reasons, missingFeatures.length > 0 || staleFeatures.length > 0 || invalidFeatures.length > 0);
  return {
    evaluationId: `${input.candidateId}:${strategyId}:${regime.policyVersion}`,
    candidateId: input.candidateId,
    strategyId,
    policyVersion: "p4-strategy-v1",
    sourceType: input.sourceType,
    evaluatedAt: input.evaluatedAt,
    marketEventAt: input.marketEventAt,
    verdict,
    regimeCompatibility,
    setupQuality,
    entryTimingQuality,
    executionQuality,
    estimatedCostPercent,
    minimumViableMovePercent,
    reasons,
    firstBlocker: reasons[0] ?? null,
    missingFeatures,
    staleFeatures,
    invalidFeatures,
    entryTrigger: strategyId,
    invalidationReason: verdict === "INELIGIBLE" ? reasons[0] ?? "INELIGIBLE" : null,
    suggestedHorizon: strategyId === "STEADY_TREND" ? "15-60m" : "3-30m",
    suggestedRiskProfile: strategyId === "RANGE_MEAN_REVERSION" ? "MEAN_REVERT" : "TREND_FOLLOW",
    suggestedExitProfile: "STANDARD",
    shadowOnly: true,
  };
}

function resolveVerdict(reasons: string[], incomplete: boolean): StrategyEvaluation["verdict"] {
  if (incomplete) return "WAIT";
  const hardReasons = reasons.filter((row) => row !== "MISSING_FEATURES" && row !== "STALE_FEATURES");
  return hardReasons.length ? "INELIGIBLE" : "ELIGIBLE";
}

function regimeScore(strategy: StrategyId, regime: MarketRegime): number {
  if (strategy === "RANGE_MEAN_REVERSION") return regime === "RANGE_SIDEWAYS" || regime === "LOW_VOLATILITY" ? 0.95 : 0.1;
  if (strategy === "STEADY_TREND") return regime === "LOW_VOLATILITY" || regime === "BULL_TREND" ? 0.8 : 0.3;
  if (strategy === "EARLY_ACCELERATION") return regime === "BULL_TREND" || regime === "TRANSITION" || regime === "LOW_VOLATILITY" ? 0.85 : 0.25;
  if (strategy === "MOMENTUM_CONTINUATION") return regime === "BULL_TREND" || regime === "HIGH_VOLATILITY" || regime === "ROCKET_PUMP" ? 0.8 : 0.2;
  return regime === "BULL_TREND" || regime === "TRANSITION" ? 0.75 : 0.2;
}

function setupScore(strategy: StrategyId, input: StrategyInput): number {
  if (strategy === "RANGE_MEAN_REVERSION") return clamp01((input.rangeScore + input.distanceFromMean + input.flowRecovery) / 3);
  if (strategy === "STEADY_TREND") return clamp01((input.relativeStrength + (1 - input.exhaustion) + (1 - input.spreadBps / 100)) / 3);
  if (strategy === "BREAKOUT_RETEST") return clamp01((input.breakoutHeld ? 1 : 0) * 0.5 + input.flowRecovery * 0.25 + input.acceleration * 0.25);
  if (strategy === "MOMENTUM_CONTINUATION") return clamp01((input.momentum + input.acceleration + input.flowRecovery) / 3);
  return clamp01((input.velocity + input.acceleration + input.volumeAcceleration + input.relativeStrength) / 4);
}

function entryTimingScore(strategy: StrategyId, input: StrategyInput): number {
  if (strategy === "BREAKOUT_RETEST") return input.breakoutHeld ? 0.8 : 0.2;
  if (strategy === "RANGE_MEAN_REVERSION") return clamp01(1 - Math.abs(input.retracement - 0.5));
  return clamp01(1 - Math.max(0, input.exhaustion - 0.4));
}

function execQualityScore(input: StrategyInput): number {
  return clamp01((input.liquidityScore + (1 - input.spreadBps / 100)) / 2);
}

function scoreEvaluation(row: StrategyEvaluation): number {
  return row.regimeCompatibility * 0.35 + row.setupQuality * 0.3 + row.entryTimingQuality * 0.2 + row.executionQuality * 0.15;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(6))));
}
