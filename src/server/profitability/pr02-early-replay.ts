import { evaluateEarlyAccelerationStrategy } from "@/src/server/profitability/pr02-early-evaluator";
import { resetEarlySetupStoreForTests } from "@/src/server/profitability/pr02-early-setup";
import {
  PR02_POLICY_VERSION,
  PR02_SCHEMA_VERSION,
  type EarlyMarketTick,
  type EarlyReplayReport,
} from "@/src/server/profitability/pr02-types";

export function runEarlyReplayAnalysis(input: {
  datasetId: string;
  ticks: EarlyMarketTick[];
}): EarlyReplayReport {
  resetEarlySetupStoreForTests();
  if (!input.ticks.length) {
    return {
      schemaVersion: PR02_SCHEMA_VERSION,
      policyVersion: PR02_POLICY_VERSION,
      datasetId: input.datasetId,
      tickCount: 0,
      warmupCount: 0,
      insufficientDataCount: 0,
      setupQualifiedCount: 0,
      triggerCount: 0,
      uniqueLifecycleTriggerCount: 0,
      expiredCount: 0,
      invalidatedCount: 0,
      duplicateSuppressedCount: 0,
      costEvidenceKnownCount: 0,
      costEvidenceUnknownCount: 0,
      status: "NOT_RUN",
      reason: "EMPTY_DATASET",
    };
  }

  const signalIds = new Set<string>();
  const lifecycleTriggers = new Set<string>();
  let warmupCount = 0;
  let insufficientDataCount = 0;
  let setupQualifiedCount = 0;
  let triggerCount = 0;
  let expiredCount = 0;
  let invalidatedCount = 0;
  let duplicateSuppressedCount = 0;
  let costEvidenceKnownCount = 0;
  let costEvidenceUnknownCount = 0;

  for (const tick of input.ticks) {
    const result = evaluateEarlyAccelerationStrategy(tick.strategyInput, tick.regime, {
      trades: tick.trades,
      book: tick.book,
      baselinePrice: tick.baselinePrice,
      firstDetectionPrice: tick.firstDetectionPrice,
      intendedNotional: tick.intendedNotional,
      lifecycleId: tick.lifecycleId,
      nowMs: tick.eventAtMs,
      replayTickIndex: tick.tickIndex,
    });
    if (result.dataValidity === "WARMUP") warmupCount += 1;
    if (result.dataValidity === "INSUFFICIENT_DATA") insufficientDataCount += 1;
    if (result.setupQualified) setupQualifiedCount += 1;
    if (result.trigger.triggered) {
      triggerCount += 1;
      if (result.trigger.signalId) signalIds.add(result.trigger.signalId);
      lifecycleTriggers.add(tick.lifecycleId);
    }
    if (result.transition?.reasonCode === "DUPLICATE_SIGNAL_SUPPRESSED") duplicateSuppressedCount += 1;
    if (result.setupState === "EXPIRED") expiredCount += 1;
    if (result.setupState === "INVALIDATED") invalidatedCount += 1;
    if (result.economicsStatus === "KNOWN") costEvidenceKnownCount += 1;
    else costEvidenceUnknownCount += 1;
  }

  return {
    schemaVersion: PR02_SCHEMA_VERSION,
    policyVersion: PR02_POLICY_VERSION,
    datasetId: input.datasetId,
    tickCount: input.ticks.length,
    warmupCount,
    insufficientDataCount,
    setupQualifiedCount,
    triggerCount,
    uniqueLifecycleTriggerCount: lifecycleTriggers.size,
    expiredCount,
    invalidatedCount,
    duplicateSuppressedCount,
    costEvidenceKnownCount,
    costEvidenceUnknownCount,
    status: "COMPLETED",
    reason: null,
  };
}

export function evaluateEarlyWithRouter(input: {
  strategyInput: EarlyMarketTick["strategyInput"];
  regime: EarlyMarketTick["regime"];
  earlyContext?: EarlyMarketTick["strategyInput"]["earlyContext"];
}) {
  const evaluation = evaluateEarlyAccelerationStrategy(input.strategyInput, input.regime, input.earlyContext);
  return {
    evaluation,
    strategyEvaluation: evaluation.strategyEvaluation,
    economics: evaluation.economics,
    setupState: evaluation.setupState,
    trigger: evaluation.trigger,
  };
}
