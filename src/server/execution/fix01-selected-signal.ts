import type {
  StrategyDetailedEvaluation,
  StrategyId,
  StrategyRouterDetailedResult,
} from "@/src/server/forensics/p4-regime-strategy-shadow";
import type { EarlyEvaluationResult } from "@/src/server/profitability/pr02-types";
import type {
  BreakoutEvaluationResult,
  InvalidationContract,
  MomentumEvaluationResult,
} from "@/src/server/profitability/pr03-types";

export const FIX01_SELECTED_SIGNAL_SCHEMA = "fix01-selected-signal-v1" as const;

export type { StrategyDetailedEvaluation };

export type SelectedStrategySignal = {
  schemaVersion: typeof FIX01_SELECTED_SIGNAL_SCHEMA;
  strategyId: StrategyId;
  policyVersion: string;
  candidateId: string;
  lifecycleId: string;
  setupId: string;
  signalId: string | null;
  featureSnapshotId: string | null;
  setupState: string;
  triggerAt: string | null;
  validUntil: string | null;
  invalidation: InvalidationContract | null;
  evaluationId: string;
  frozenAt: string;
  sourceObservations: string[];
};

function cloneInvalidation(invalidation: InvalidationContract | null): InvalidationContract | null {
  if (!invalidation) return null;
  return {
    referenceLevel: invalidation.referenceLevel,
    invalidationThreshold: invalidation.invalidationThreshold,
    reasonCode: invalidation.reasonCode,
    computedAtMs: invalidation.computedAtMs,
    availableAtMs: invalidation.availableAtMs,
    validUntilMs: invalidation.validUntilMs,
    sourceObservations: [...invalidation.sourceObservations],
  };
}

export function freezeSelectedStrategySignal(
  strategyId: StrategyId,
  detail: StrategyDetailedEvaluation,
): SelectedStrategySignal {
  const frozenAt = new Date(detail.evaluatedAt).toISOString();
  if (strategyId === "EARLY_ACCELERATION") {
    const early = detail as EarlyEvaluationResult;
    return {
      schemaVersion: FIX01_SELECTED_SIGNAL_SCHEMA,
      strategyId,
      policyVersion: early.policyVersion,
      candidateId: early.candidateId,
      lifecycleId: early.lifecycleId,
      setupId: early.setupId,
      signalId: early.trigger.signalId,
      featureSnapshotId: early.featureSnapshotId,
      setupState: early.setupState,
      triggerAt: early.trigger.triggerAt,
      validUntil: early.trigger.validUntil,
      invalidation: cloneInvalidation(early.invalidation),
      evaluationId: early.strategyEvaluation.evaluationId,
      frozenAt,
      sourceObservations: early.invalidation?.sourceObservations ?? [],
    };
  }
  if (strategyId === "MOMENTUM_CONTINUATION") {
    const momentum = detail as MomentumEvaluationResult;
    return {
      schemaVersion: FIX01_SELECTED_SIGNAL_SCHEMA,
      strategyId,
      policyVersion: momentum.policyVersion,
      candidateId: momentum.candidateId,
      lifecycleId: momentum.lifecycleId,
      setupId: momentum.setupId,
      signalId: momentum.trigger.signalId,
      featureSnapshotId: momentum.featureSnapshotId,
      setupState: momentum.setupState,
      triggerAt: momentum.trigger.triggerAt,
      validUntil: momentum.trigger.validUntil,
      invalidation: cloneInvalidation(momentum.invalidation),
      evaluationId: momentum.strategyEvaluation.evaluationId,
      frozenAt,
      sourceObservations: momentum.invalidation?.sourceObservations ?? [],
    };
  }
  const breakout = detail as BreakoutEvaluationResult;
  return {
    schemaVersion: FIX01_SELECTED_SIGNAL_SCHEMA,
    strategyId: "BREAKOUT_RETEST",
    policyVersion: breakout.policyVersion,
    candidateId: breakout.candidateId,
    lifecycleId: breakout.lifecycleId,
    setupId: breakout.setupId,
    signalId: breakout.trigger.signalId,
    featureSnapshotId: breakout.featureSnapshotId,
    setupState: breakout.setupState,
    triggerAt: breakout.trigger.triggerAt,
    validUntil: breakout.trigger.validUntil,
    invalidation: cloneInvalidation(breakout.invalidation),
    evaluationId: breakout.strategyEvaluation.evaluationId,
    frozenAt,
    sourceObservations: breakout.invalidation?.sourceObservations ?? [],
  };
}

export function buildSelectedStrategySignal(
  strategyId: StrategyId | null | undefined,
  router: StrategyRouterDetailedResult,
): SelectedStrategySignal | null {
  if (!strategyId) return null;
  const detail = router.strategyDetails[strategyId];
  if (!detail) return null;
  if (
    strategyId !== "EARLY_ACCELERATION" &&
    strategyId !== "MOMENTUM_CONTINUATION" &&
    strategyId !== "BREAKOUT_RETEST"
  ) {
    return null;
  }
  return freezeSelectedStrategySignal(strategyId, detail);
}

export function resolveInvalidationFromSelectedSignal(
  signal: SelectedStrategySignal | null | undefined,
): InvalidationContract | null {
  return signal?.invalidation ?? null;
}
