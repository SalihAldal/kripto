import type { RegimeSnapshot, StrategyId, StrategyInput } from "@/src/server/forensics/p4-regime-strategy-shadow";
import type { InvalidationContract } from "@/src/server/profitability/pr03-types";
import { evaluateBreakoutRetestStrategy } from "@/src/server/profitability/pr03-breakout-evaluator";
import { evaluateMomentumContinuationStrategy } from "@/src/server/profitability/pr03-momentum-evaluator";
import {
  buildExitPolicySnapshotAtEntry,
  evaluateExitPolicyTick,
  getExitPolicyState,
  initializeExitPolicyState,
} from "@/src/server/profitability/pr04-exit-evaluator";
import type { ExitPolicyId, ExitTickObservation } from "@/src/server/profitability/pr04-types";
import { defaultExitPolicyId } from "@/src/server/profitability/pr04-policy-registry";

export function resolveInvalidationForSelectedStrategy(input: {
  strategyId: StrategyId;
  strategyInput: StrategyInput;
  regime: RegimeSnapshot;
}): InvalidationContract | null {
  if (input.strategyId === "MOMENTUM_CONTINUATION") {
    return evaluateMomentumContinuationStrategy(
      input.strategyInput,
      input.regime,
      input.strategyInput.strategyContext,
    ).invalidation;
  }
  if (input.strategyId === "BREAKOUT_RETEST") {
    return evaluateBreakoutRetestStrategy(
      input.strategyInput,
      input.regime,
      input.strategyInput.strategyContext,
    ).invalidation;
  }
  return null;
}

export function isPr04ExitEvaluationEnabled() {
  return process.env.EXECUTION_PR04_EXIT_EVAL_ENABLED === "true";
}

export function buildPr04ExitMetadataAtEntry(input: {
  positionId: string;
  strategyId: StrategyId;
  entryPolicyVersion: string;
  entrySignalId?: string | null;
  setupId?: string | null;
  takeProfitPercent?: number | null;
  invalidation?: InvalidationContract | null;
  exitPolicyId?: ExitPolicyId;
}) {
  const snapshot = buildExitPolicySnapshotAtEntry({
    positionId: input.positionId,
    strategyId: input.strategyId,
    entryPolicyVersion: input.entryPolicyVersion,
    entrySignalId: input.entrySignalId ?? null,
    setupId: input.setupId ?? null,
    exitPolicyId: input.exitPolicyId ?? defaultExitPolicyId(),
    experimentalMode: isPr04ExitEvaluationEnabled(),
    takeProfitPercent: input.takeProfitPercent ?? null,
    invalidation: input.invalidation ?? null,
  });
  return snapshot;
}

export function bootstrapPr04ExitStateFromEntry(input: {
  snapshot: ReturnType<typeof buildExitPolicySnapshotAtEntry>;
  side: "LONG" | "SHORT";
  entryPrice: number;
  quantity: number;
  entryFee: number;
  openedAtMs: number;
}) {
  if (!input.snapshot.experimentalMode) return null;
  return initializeExitPolicyState({
    snapshot: input.snapshot,
    side: input.side,
    entryFills: [{ price: input.entryPrice, quantity: input.quantity, fee: input.entryFee, atMs: input.openedAtMs }],
    entryFee: input.entryFee,
  });
}

export function evaluatePr04ExitShadowTick(input: {
  positionId: string;
  side: "LONG" | "SHORT";
  markPrice: number;
  high?: number | null;
  low?: number | null;
  eventAtMs: number;
}) {
  if (!isPr04ExitEvaluationEnabled()) return null;
  const state = getExitPolicyState(input.positionId);
  if (!state) return null;
  const observation: ExitTickObservation = {
    eventId: `${input.positionId}:${input.eventAtMs}`,
    eventAtMs: input.eventAtMs,
    availableAtMs: input.eventAtMs,
    markPrice: input.markPrice,
    bid: input.markPrice,
    ask: input.markPrice,
    high: input.high ?? null,
    low: input.low ?? null,
    closed: true,
    stale: false,
    dataGap: false,
  };
  return evaluateExitPolicyTick({ positionId: input.positionId, side: input.side, observation });
}

export function resolvePr04CloseQuantity(positionId: string, fallbackQuantity: number) {
  const state = getExitPolicyState(positionId);
  if (!state || !state.snapshot.experimentalMode) return fallbackQuantity;
  return state.remainingQuantity > 0 ? state.remainingQuantity : fallbackQuantity;
}
