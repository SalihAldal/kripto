import { AsyncLocalStorage } from "node:async_hooks";
import type { DecisionTimelineInput, FeatureSnapshotInput, RejectReasonInput, DecisionScoreSnapshot } from "@/src/server/observability/decision-observability.types";

export type ActiveDecisionTrace = {
  decisionId: string;
  analysisId?: string;
  symbol: string;
  deferPersistence: boolean;
  timeline: DecisionTimelineInput[];
  rejectReasons: RejectReasonInput[];
  scores: DecisionScoreSnapshot;
  features?: FeatureSnapshotInput;
  strategyUsed?: string;
  marketState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

const decisionTraceStorage = new AsyncLocalStorage<ActiveDecisionTrace>();

export function runWithDecisionTrace<T>(trace: ActiveDecisionTrace, fn: () => Promise<T>): Promise<T> {
  return decisionTraceStorage.run(trace, fn);
}

export function getActiveDecisionTrace(): ActiveDecisionTrace | undefined {
  return decisionTraceStorage.getStore();
}

export function getActiveDecisionId(): string | undefined {
  return decisionTraceStorage.getStore()?.decisionId;
}

export function isDecisionPersistenceDeferred(): boolean {
  return Boolean(decisionTraceStorage.getStore()?.deferPersistence);
}

export function appendDecisionTimeline(event: DecisionTimelineInput) {
  const trace = decisionTraceStorage.getStore();
  if (!trace) return;
  trace.timeline.push(event);
}

export function mergeDecisionScores(scores: DecisionScoreSnapshot) {
  const trace = decisionTraceStorage.getStore();
  if (!trace) return;
  trace.scores = { ...trace.scores, ...scores };
}

export function mergeDecisionRejectReasons(reasons: RejectReasonInput[]) {
  const trace = decisionTraceStorage.getStore();
  if (!trace) return;
  trace.rejectReasons.push(...reasons);
}

export function mergeDecisionFeatures(features: FeatureSnapshotInput) {
  const trace = decisionTraceStorage.getStore();
  if (!trace) return;
  trace.features = { ...(trace.features ?? {}), ...features };
}

export function mergeDecisionMetadata(metadata: Record<string, unknown>) {
  const trace = decisionTraceStorage.getStore();
  if (!trace) return;
  trace.metadata = { ...(trace.metadata ?? {}), ...metadata };
}

export function setDecisionMarketState(marketState: Record<string, unknown>) {
  const trace = decisionTraceStorage.getStore();
  if (!trace) return;
  trace.marketState = { ...(trace.marketState ?? {}), ...marketState };
}

export function setDecisionStrategyUsed(strategyUsed: string) {
  const trace = decisionTraceStorage.getStore();
  if (!trace) return;
  trace.strategyUsed = strategyUsed;
}

export function takeActiveDecisionTrace(): ActiveDecisionTrace | undefined {
  const trace = decisionTraceStorage.getStore();
  return trace ? { ...trace, timeline: [...trace.timeline], rejectReasons: [...trace.rejectReasons] } : undefined;
}
