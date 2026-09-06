import { createHash } from "node:crypto";
import type { RegimeSnapshot, StrategyEvaluation, StrategyInput } from "@/src/server/forensics/p4-regime-strategy-shadow";
import { computeMinimumViableMove } from "@/src/server/forensics/p4-regime-strategy-shadow";
import { buildTradeEconomicsRecord } from "@/src/server/profitability/pr01-economics";
import {
  computeFlowFromTrades,
  computeImpulseMetrics,
  MIN_CLOSED_CANDLES,
  MOMENTUM_IMPULSE_MIN_PCT,
  MOMENTUM_MAX_EXTENSION_PCT,
  MOMENTUM_PAUSE_MAX_RETRACE_PCT,
  resolveStrategyContext,
} from "@/src/server/profitability/pr03-causal-features";
import {
  getFrozenMomentumImpulse,
  getMomentumSetupState,
  MOMENTUM_SETUP_EXPIRE_MS,
  MOMENTUM_TRIGGER_VALID_MS,
  processMomentumSetupTransition,
  shouldSuppressMomentumDuplicate,
} from "@/src/server/profitability/pr03-momentum-setup";
import {
  PR03_POLICY_VERSION,
  PR03_SCHEMA_VERSION,
  type InvalidationContract,
  type MomentumEvaluationResult,
  type MomentumSetupState,
  type StrategyContextExtension,
  type StrategyTriggerResult,
} from "@/src/server/profitability/pr03-types";

const POLICY = {
  minPauseRetracePct: 0.08,
  minFlowImbalance: 0.05,
  minResumptionClosePct: 0.12,
} as const;

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(6))));
}

function buildSignalId(candidateId: string, lifecycleId: string, generation: number, eventAtMs: number) {
  return createHash("sha256").update(`MOMENTUM:${candidateId}:${lifecycleId}:${generation}:${eventAtMs}`).digest("hex").slice(0, 24);
}

export function evaluateMomentumSetupQualification(input: {
  warmupComplete: boolean;
  impulseConfirmed: boolean;
  pauseObserved: boolean;
  resumptionArmed: boolean;
  flow: ReturnType<typeof computeFlowFromTrades>;
  extensionExceeded: boolean;
  invalidated: boolean;
}): { qualified: boolean; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  if (!input.warmupComplete) reasonCodes.push("WARMUP_INCOMPLETE");
  if (!input.impulseConfirmed) reasonCodes.push("IMPULSE_NOT_CONFIRMED");
  if (!input.pauseObserved) reasonCodes.push("PAUSE_NOT_OBSERVED");
  if (!input.resumptionArmed) reasonCodes.push("RESUMPTION_NOT_ARMED");
  if (input.flow.quality !== "VALID" || input.flow.value == null) reasonCodes.push("FLOW_DATA_MISSING");
  if (input.extensionExceeded) reasonCodes.push("EXTENSION_EXCEEDED");
  if (input.invalidated) reasonCodes.push("SETUP_INVALIDATED");
  return { qualified: reasonCodes.length === 0, reasonCodes };
}

export function evaluateMomentumEntryTrigger(
  setupQualified: boolean,
  flowValue: number | null,
  resumptionPct: number | null,
): StrategyTriggerResult {
  const reasonCodes: string[] = [];
  if (!setupQualified) reasonCodes.push("SETUP_NOT_QUALIFIED");
  const flowOk = flowValue != null && flowValue >= POLICY.minFlowImbalance;
  const resumptionOk = resumptionPct != null && resumptionPct >= POLICY.minResumptionClosePct;
  if (!flowOk) reasonCodes.push("FLOW_RESUMPTION_WEAK");
  if (!resumptionOk) reasonCodes.push("PRICE_RESUMPTION_WEAK");
  const entryTriggerMet = setupQualified && flowOk && resumptionOk;
  const rankingScore = clamp01(
    (flowOk ? 0.35 : 0) + (resumptionOk ? 0.35 : 0) + (setupQualified ? 0.3 : 0),
  );
  return {
    triggered: entryTriggerMet,
    signalId: null,
    triggerAt: null,
    validUntil: null,
    reasonCodes,
    setupQualified,
    entryTriggerMet,
    rankingScore,
  };
}

function mapToStrategyEvaluation(
  input: StrategyInput,
  regime: RegimeSnapshot,
  trigger: StrategyTriggerResult,
  setupState: MomentumSetupState,
  legacySetupScore: number,
): StrategyEvaluation {
  const reasons: string[] = [];
  const missingAll = new Set(input.missingFeatures ?? []);
  const required = [
    "expectedMovePercent", "entrySpread", "entrySlippage", "entryFee", "exitSpread", "exitSlippage", "exitFee",
    "liquidityScore", "marketEventAt", "momentum", "acceleration", "flowRecovery",
  ];
  const missingFeatures = required.filter((key) => missingAll.has(key));
  const staleFeatures = [...(input.staleFeatures ?? [])];
  const invalidFeatures = [...(input.invalidFeatures ?? [])];
  const minimumViableMovePercent = computeMinimumViableMove(input);
  const regimeCompatibility =
    regime.regime === "BULL_TREND" || regime.regime === "HIGH_VOLATILITY" || regime.regime === "ROCKET_PUMP" ? 0.8 : 0.2;
  const setupQuality = trigger.setupQualified ? Math.max(trigger.rankingScore, legacySetupScore) : trigger.rankingScore;
  const entryTimingQuality = trigger.entryTriggerMet ? 0.82 : 0.2;
  const executionQuality = clamp01((input.liquidityScore + (1 - input.spreadBps / 100)) / 2);
  if (missingFeatures.length > 0) reasons.push("MISSING_FEATURES");
  if (staleFeatures.length > 0) reasons.push("STALE_FEATURES");
  if (invalidFeatures.length > 0) reasons.push("INVALID_FEATURES");
  if (input.expectedMovePercent <= minimumViableMovePercent) reasons.push("COST_NOT_VIABLE");
  if (regimeCompatibility < 0.35) reasons.push("REGIME_MISMATCH");
  if (!trigger.setupQualified) reasons.push("SETUP_WEAK");
  if (!trigger.entryTriggerMet) reasons.push("ENTRY_TIMING_WEAK");
  if (executionQuality < 0.45) reasons.push("EXECUTION_QUALITY_WEAK");
  if (setupState === "EXPIRED") reasons.push("SETUP_EXPIRED");
  if (setupState === "INVALIDATED") reasons.push("SETUP_INVALIDATED");
  const incomplete = missingFeatures.length > 0 || staleFeatures.length > 0 || invalidFeatures.length > 0;
  const hardReasons = reasons.filter((r) => !["MISSING_FEATURES", "STALE_FEATURES"].includes(r));
  const verdict: StrategyEvaluation["verdict"] = incomplete
    ? "WAIT"
    : hardReasons.length
      ? "INELIGIBLE"
      : trigger.triggered
        ? "ELIGIBLE"
        : "INELIGIBLE";
  return {
    evaluationId: `${input.candidateId}:MOMENTUM_CONTINUATION:${PR03_POLICY_VERSION}`,
    candidateId: input.candidateId,
    strategyId: "MOMENTUM_CONTINUATION",
    policyVersion: PR03_POLICY_VERSION,
    sourceType: input.sourceType,
    evaluatedAt: input.evaluatedAt,
    marketEventAt: input.marketEventAt,
    verdict,
    regimeCompatibility,
    setupQuality,
    entryTimingQuality,
    executionQuality,
    estimatedCostPercent: minimumViableMovePercent - input.strategyProfitBuffer,
    minimumViableMovePercent,
    reasons,
    firstBlocker: reasons[0] ?? null,
    missingFeatures,
    staleFeatures,
    invalidFeatures,
    entryTrigger: trigger.triggered ? "MOMENTUM_PAUSE_RESUMPTION" : "NONE",
    invalidationReason: setupState === "INVALIDATED" ? "SETUP_INVALIDATED" : setupState === "EXPIRED" ? "SETUP_EXPIRED" : null,
    suggestedHorizon: "3-30m",
    suggestedRiskProfile: "TREND_FOLLOW",
    suggestedExitProfile: "STANDARD",
    shadowOnly: true,
  };
}

function buildMomentumProducerContextMissingResult(
  input: StrategyInput,
  regime: RegimeSnapshot,
  ctx: ReturnType<typeof resolveStrategyContext>,
): MomentumEvaluationResult {
  const trigger: StrategyTriggerResult = {
    triggered: false,
    signalId: null,
    triggerAt: null,
    validUntil: null,
    reasonCodes: ["PRODUCER_CONTEXT_MISSING"],
    setupQualified: false,
    entryTriggerMet: false,
    rankingScore: 0,
  };
  const strategyEvaluation = mapToStrategyEvaluation(input, regime, trigger, "WARMUP", 0);
  return {
    schemaVersion: PR03_SCHEMA_VERSION,
    policyVersion: PR03_POLICY_VERSION,
    candidateId: input.candidateId,
    lifecycleId: ctx.lifecycleId,
    setupId: `${input.candidateId}:momentum-pending`,
    strategyId: "MOMENTUM_CONTINUATION",
    featureSnapshotId: ctx.featureSnapshotId,
    sourceType: input.sourceType,
    marketEventAt: input.marketEventAt,
    evaluatedAt: input.evaluatedAt,
    setupState: "WARMUP",
    impulseReferencePrice: null,
    invalidation: null,
    trigger,
    transition: null,
    economics: buildTradeEconomicsRecord({
      candidateId: input.candidateId,
      strategyId: "MOMENTUM_CONTINUATION",
      featureSnapshotId: ctx.featureSnapshotId,
      costSource: "UNKNOWN",
    }),
    economicsStatus: "UNKNOWN",
    strategyEvaluation,
  };
}

export function evaluateMomentumContinuationStrategy(
  input: StrategyInput,
  regime: RegimeSnapshot,
  strategyContext?: StrategyContextExtension,
): MomentumEvaluationResult {
  const ctx = resolveStrategyContext(strategyContext ?? input.strategyContext, input);
  if (!ctx.candles.length && !ctx.trades.length) {
    return buildMomentumProducerContextMissingResult(input, regime, ctx);
  }

  const persistLifecycle = Boolean(ctx.candles.length > 0 || ctx.trades.length > 0);
  const terminalState = persistLifecycle ? getMomentumSetupState(input.candidateId, ctx.lifecycleId) : "WARMUP";
  const frozen = persistLifecycle ? getFrozenMomentumImpulse(input.candidateId, ctx.lifecycleId) : null;

  const closedCount = ctx.candles.filter((c) => c.closed && c.availableAt <= ctx.nowMs).length;
  const warmupComplete = closedCount >= MIN_CLOSED_CANDLES;

  const metrics = computeImpulseMetrics(ctx.candles, ctx.nowMs);
  const impulseReferencePrice = frozen?.impulseReferencePrice ?? metrics.peakPrice ?? null;
  const impulseAtMs = frozen?.impulseAtMs ?? null;

  const impulseConfirmed =
    metrics.quality === "VALID" &&
    metrics.impulsePct != null &&
    metrics.impulsePct >= MOMENTUM_IMPULSE_MIN_PCT;
  const pauseObserved =
    metrics.quality === "VALID" &&
    metrics.pauseRetracePct != null &&
    metrics.pauseRetracePct >= POLICY.minPauseRetracePct &&
    metrics.pauseRetracePct <= MOMENTUM_PAUSE_MAX_RETRACE_PCT;
  const extensionExceeded =
    metrics.extensionPct != null && metrics.extensionPct > MOMENTUM_MAX_EXTENSION_PCT;

  const latestClosed = ctx.candles.filter((c) => c.closed && c.availableAt <= ctx.nowMs).at(-1);
  const pauseLow = metrics.peakPrice != null && latestClosed
    ? Math.min(latestClosed.low, latestClosed.close)
    : null;
  const resumptionPct =
    impulseReferencePrice != null && latestClosed && metrics.impulseStartPrice != null
      ? ((latestClosed.close - (pauseLow ?? latestClosed.low)) / Math.max(metrics.impulseStartPrice, 1)) * 100
      : null;
  const resumptionArmed = pauseObserved && resumptionPct != null && resumptionPct >= POLICY.minResumptionClosePct * 0.5;

  const flow = computeFlowFromTrades(ctx.trades, ctx.nowMs);
  let invalidated = terminalState === "INVALIDATED" || extensionExceeded;

  const setupCheck = evaluateMomentumSetupQualification({
    warmupComplete,
    impulseConfirmed,
    pauseObserved,
    resumptionArmed,
    flow,
    extensionExceeded,
    invalidated,
  });

  let trigger = evaluateMomentumEntryTrigger(setupCheck.qualified, flow.value, resumptionPct);
  if (!setupCheck.qualified) {
    trigger = {
      ...trigger,
      reasonCodes: [...new Set([...setupCheck.reasonCodes, ...trigger.reasonCodes])],
    };
  }

  const priorGen = persistLifecycle
    ? (getMomentumSetupState(input.candidateId, ctx.lifecycleId) === "TRIGGERED" ? 1 : 0)
    : 0;
  const signalId = trigger.triggered ? buildSignalId(input.candidateId, ctx.lifecycleId, priorGen + 1, ctx.nowMs) : null;
  const duplicate = signalId && persistLifecycle
    ? shouldSuppressMomentumDuplicate(input.candidateId, ctx.lifecycleId, signalId)
    : false;
  if (duplicate) {
    trigger = { ...trigger, triggered: false, reasonCodes: [...trigger.reasonCodes, "DUPLICATE_SIGNAL_SUPPRESSED"] };
  }

  const setupStarted = frozen?.impulseReferencePrice != null;
  const expired =
    terminalState === "EXPIRED" ||
    (setupStarted && frozen?.impulseAtMs != null && ctx.nowMs - frozen.impulseAtMs > MOMENTUM_SETUP_EXPIRE_MS && !trigger.triggered);

  const lifecycleTriggerIntent = Boolean(signalId) && (trigger.triggered || duplicate);
  const transition = persistLifecycle
    ? processMomentumSetupTransition({
        candidateId: input.candidateId,
        lifecycleId: ctx.lifecycleId,
        eventAtMs: ctx.nowMs,
        availableAtMs: ctx.nowMs,
        snapshotReference: ctx.featureSnapshotId,
        warmupComplete,
        impulseConfirmed,
        pauseObserved,
        resumptionArmed,
        triggerFired: lifecycleTriggerIntent && !expired && !invalidated,
        invalidated,
        expired,
        signalId: lifecycleTriggerIntent ? signalId : null,
        impulseReferencePrice,
        impulseAtMs: impulseAtMs ?? (impulseConfirmed ? ctx.nowMs : null),
        pauseLowPrice: pauseLow,
      })
    : null;

  const setupState: MomentumSetupState = transition?.newState ?? (
    trigger.triggered ? "TRIGGERED" : resumptionArmed ? "RESUMPTION_ARMED" : pauseObserved ? "PAUSE_OBSERVED" : impulseConfirmed ? "IMPULSE_CONFIRMED" : warmupComplete ? "OBSERVING" : "WARMUP"
  );

  if (trigger.triggered && !duplicate && signalId) {
    trigger = {
      ...trigger,
      signalId,
      triggerAt: new Date(ctx.nowMs).toISOString(),
      validUntil: new Date(ctx.nowMs + MOMENTUM_TRIGGER_VALID_MS).toISOString(),
    };
  }

  const legacySetupScore = clamp01((input.momentum + input.acceleration + input.flowRecovery) / 3);

  const invalidation: InvalidationContract | null =
    impulseReferencePrice != null && metrics.impulseStartPrice != null
      ? {
          referenceLevel: metrics.impulseStartPrice,
          invalidationThreshold: metrics.impulseStartPrice * 0.995,
          reasonCode: "IMPULSE_STRUCTURE_BREACH",
          computedAtMs: ctx.nowMs,
          availableAtMs: ctx.nowMs,
          validUntilMs: ctx.nowMs + MOMENTUM_SETUP_EXPIRE_MS,
          sourceObservations: ["IMPULSE_START_OPEN", "PAUSE_LOW"],
        }
      : null;

  const economicsStatus =
    input.expectedMovePercent > 0 && input.entryFee > 0 && input.expectedMovePercent > computeMinimumViableMove(input)
      ? "KNOWN"
      : "UNKNOWN";
  const economics =
    economicsStatus === "KNOWN"
      ? buildTradeEconomicsRecord({
          candidateId: input.candidateId,
          strategyId: "MOMENTUM_CONTINUATION",
          featureSnapshotId: ctx.featureSnapshotId,
          expectedMovePercent: input.expectedMovePercent,
          expectedMoveSource: "scenario_fixture",
          expectedMoveQuality: "VALID",
          entryPrice: latestClosed?.close ?? null,
          costSource: "CONFIGURED_ASSUMPTION",
          grossMovePct: resumptionPct,
        })
      : buildTradeEconomicsRecord({
          candidateId: input.candidateId,
          strategyId: "MOMENTUM_CONTINUATION",
          featureSnapshotId: ctx.featureSnapshotId,
          costSource: "UNKNOWN",
        });

  const strategyEvaluation = mapToStrategyEvaluation(
    input,
    regime,
    trigger,
    setupState,
    legacySetupScore,
  );

  return {
    schemaVersion: PR03_SCHEMA_VERSION,
    policyVersion: PR03_POLICY_VERSION,
    candidateId: input.candidateId,
    lifecycleId: ctx.lifecycleId,
    setupId: transition?.setupId ?? `${input.candidateId}:momentum-pending`,
    strategyId: "MOMENTUM_CONTINUATION",
    featureSnapshotId: ctx.featureSnapshotId,
    sourceType: input.sourceType,
    marketEventAt: input.marketEventAt,
    evaluatedAt: input.evaluatedAt,
    setupState,
    impulseReferencePrice,
    invalidation,
    trigger,
    transition,
    economics,
    economicsStatus,
    strategyEvaluation,
  };
}

export { POLICY as MOMENTUM_CONTINUATION_POLICY };
