import type { RegimeSnapshot, StrategyId, StrategyInput } from "@/src/server/forensics/p4-regime-strategy-shadow";
import type { SelectedStrategySignal } from "@/src/server/execution/fix01-selected-signal";
import { resolveInvalidationFromSelectedSignal } from "@/src/server/execution/fix01-selected-signal";
import type { InvalidationContract } from "@/src/server/profitability/pr03-types";
import {
  buildExitPolicySnapshotAtEntry,
  evaluateExitPolicyTick,
  getExitPolicyState,
  initializeExitPolicyState,
} from "@/src/server/profitability/pr04-exit-evaluator";
import type { ExitPolicyId, ExitTickObservation } from "@/src/server/profitability/pr04-types";
import { defaultExitPolicyId } from "@/src/server/profitability/pr04-policy-registry";

/** @deprecated Re-evaluation removed — pass selectedSignal from router instead. */
export function resolveInvalidationForSelectedStrategy(input: {
  strategyId: StrategyId;
  strategyInput: StrategyInput;
  regime: RegimeSnapshot;
  selectedSignal?: SelectedStrategySignal | null;
}): InvalidationContract | null {
  return resolveInvalidationFromSelectedSignal(input.selectedSignal);
}

export function isPr04ExitEvaluationEnabled() {
  return process.env.EXECUTION_PR04_EXIT_EVAL_ENABLED === "true";
}

export function isPr04ExitRoutingEnabled() {
  return process.env.EXECUTION_PR04_EXIT_ROUTING_ENABLED === "true";
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

export function buildPr04ExitMetadataFromSelectedSignal(input: {
  positionId: string;
  selectedSignal: SelectedStrategySignal;
  takeProfitPercent?: number | null;
  exitPolicyId?: ExitPolicyId;
}) {
  return buildPr04ExitMetadataAtEntry({
    positionId: input.positionId,
    strategyId: input.selectedSignal.strategyId,
    entryPolicyVersion: input.selectedSignal.policyVersion,
    entrySignalId: input.selectedSignal.signalId,
    setupId: input.selectedSignal.setupId,
    takeProfitPercent: input.takeProfitPercent ?? null,
    invalidation: input.selectedSignal.invalidation,
    exitPolicyId: input.exitPolicyId,
  });
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
  bid?: number | null;
  ask?: number | null;
  high?: number | null;
  low?: number | null;
  eventAtMs: number;
  availableAtMs?: number;
  stale?: boolean;
  dataGap?: boolean;
}) {
  if (!isPr04ExitEvaluationEnabled()) return null;
  const state = getExitPolicyState(input.positionId);
  if (!state) return null;
  const bid = input.bid ?? null;
  const ask = input.ask ?? null;
  const observation: ExitTickObservation = {
    eventId: `${input.positionId}:${input.eventAtMs}`,
    eventAtMs: input.eventAtMs,
    availableAtMs: input.availableAtMs ?? input.eventAtMs,
    markPrice: input.markPrice,
    bid,
    ask,
    high: input.high ?? null,
    low: input.low ?? null,
    closed: bid != null && ask != null,
    stale: input.stale ?? false,
    dataGap: input.dataGap ?? (input.markPrice == null),
  };
  return evaluateExitPolicyTick({
    positionId: input.positionId,
    side: input.side,
    observation,
    dryRun: true,
  });
}

export function resolvePr04CloseQuantity(positionId: string, fallbackQuantity: number) {
  const state = getExitPolicyState(positionId);
  if (!state || !state.snapshot.experimentalMode) return fallbackQuantity;
  return state.remainingQuantity > 0 ? state.remainingQuantity : fallbackQuantity;
}
