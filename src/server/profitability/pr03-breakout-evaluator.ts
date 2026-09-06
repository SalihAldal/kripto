import { createHash } from "node:crypto";
import type { RegimeSnapshot, StrategyEvaluation, StrategyInput } from "@/src/server/forensics/p4-regime-strategy-shadow";
import { computeMinimumViableMove } from "@/src/server/forensics/p4-regime-strategy-shadow";
import { buildTradeEconomicsRecord } from "@/src/server/profitability/pr01-economics";
import {
  BREAKOUT_SETUP_EXPIRE_MS,
  BREAKOUT_TRIGGER_VALID_MS,
  getBreakoutSetupState,
  getBreakoutLastSignalId,
  getBreakoutTriggerGeneration,
  getFrozenBreakoutLevel,
  processBreakoutSetupTransition,
  shouldSuppressBreakoutDuplicate,
} from "@/src/server/profitability/pr03-breakout-setup";
import {
  computeConfirmedPivotLevel,
  computeFlowFromTrades,
  findFirstBreakoutAfterLevel,
  detectHoldAboveLevel,
  detectRetest,
  HOLD_INVALIDATION_BPS,
  MIN_CLOSED_CANDLES,
  resolveStrategyContext,
} from "@/src/server/profitability/pr03-causal-features";
import {
  PR03_POLICY_VERSION,
  PR03_SCHEMA_VERSION,
  type BreakoutEvaluationResult,
  type BreakoutSetupState,
  type InvalidationContract,
  type StrategyContextExtension,
  type StrategyTriggerResult,
} from "@/src/server/profitability/pr03-types";

const POLICY = {
  minFlowImbalance: 0.06,
  minReaccelerationClosePct: 0.08,
  retestExpireMs: 420_000,
} as const;

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(6))));
}

function buildSignalId(candidateId: string, lifecycleId: string, generation: number, eventAtMs: number) {
  return createHash("sha256").update(`BREAKOUT:${candidateId}:${lifecycleId}:${generation}:${eventAtMs}`).digest("hex").slice(0, 24);
}

function buildInvalidation(level: number, asOfMs: number): InvalidationContract {
  const threshold = level * (1 - HOLD_INVALIDATION_BPS / 10_000);
  return {
    referenceLevel: level,
    invalidationThreshold: threshold,
    reasonCode: "LEVEL_HOLD_BREACH",
    computedAtMs: asOfMs,
    availableAtMs: asOfMs,
    validUntilMs: asOfMs + BREAKOUT_SETUP_EXPIRE_MS,
    sourceObservations: ["CONFIRMED_PIVOT_HIGH", "CLOSED_CANDLE_LOW"],
  };
}

export function evaluateBreakoutSetupQualification(input: {
  warmupComplete: boolean;
  referenceLevel: ReturnType<typeof computeConfirmedPivotLevel>;
  flow: ReturnType<typeof computeFlowFromTrades>;
  breakoutConfirmed: boolean;
  retestObserved: boolean;
  holdConfirmed: boolean;
  invalidated: boolean;
}): { qualified: boolean; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  if (!input.warmupComplete) reasonCodes.push("WARMUP_INCOMPLETE");
  if (input.referenceLevel.quality !== "VALID" || input.referenceLevel.level == null) reasonCodes.push("LEVEL_NOT_READY");
  if (input.flow.quality !== "VALID" || input.flow.value == null) reasonCodes.push("FLOW_DATA_MISSING");
  if (!input.breakoutConfirmed) reasonCodes.push("BREAKOUT_NOT_CONFIRMED");
  if (!input.retestObserved) reasonCodes.push("RETEST_NOT_OBSERVED");
  if (!input.holdConfirmed) reasonCodes.push("HOLD_NOT_CONFIRMED");
  if (input.invalidated) reasonCodes.push("SETUP_INVALIDATED");
  return { qualified: reasonCodes.length === 0, reasonCodes };
}

export function evaluateBreakoutEntryTrigger(
  setupQualified: boolean,
  flowValue: number | null,
  reaccelerationPct: number | null,
): StrategyTriggerResult {
  const reasonCodes: string[] = [];
  if (!setupQualified) reasonCodes.push("SETUP_NOT_QUALIFIED");
  const flowOk = flowValue != null && flowValue >= POLICY.minFlowImbalance;
  const reaccelOk = reaccelerationPct != null && reaccelerationPct >= POLICY.minReaccelerationClosePct;
  if (!flowOk) reasonCodes.push("FLOW_REACCELERATION_WEAK");
  if (!reaccelOk) reasonCodes.push("PRICE_REACCELERATION_WEAK");
  const entryTriggerMet = setupQualified && flowOk && reaccelOk;
  const rankingScore = clamp01(
    (flowOk ? 0.35 : 0) + (reaccelOk ? 0.35 : 0) + (setupQualified ? 0.3 : 0),
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
  setupState: BreakoutSetupState,
  legacySetupScore: number,
): StrategyEvaluation {
  const reasons: string[] = [];
  const missingAll = new Set(input.missingFeatures ?? []);
  const required = [
    "expectedMovePercent", "entrySpread", "entrySlippage", "entryFee", "exitSpread", "exitSlippage", "exitFee",
    "liquidityScore", "marketEventAt", "breakoutHeld", "flowRecovery", "acceleration",
  ];
  const missingFeatures = required.filter((key) => missingAll.has(key));
  const staleFeatures = [...(input.staleFeatures ?? [])];
  const invalidFeatures = [...(input.invalidFeatures ?? [])];
  const minimumViableMovePercent = computeMinimumViableMove(input);
  const regimeCompatibility =
    regime.regime === "BULL_TREND" || regime.regime === "TRANSITION" ? 0.75 : 0.2;
  const setupQuality = trigger.setupQualified ? Math.max(trigger.rankingScore, legacySetupScore) : trigger.rankingScore;
  const entryTimingQuality = trigger.entryTriggerMet ? 0.85 : 0.2;
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
    evaluationId: `${input.candidateId}:BREAKOUT_RETEST:${PR03_POLICY_VERSION}`,
    candidateId: input.candidateId,
    strategyId: "BREAKOUT_RETEST",
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
    entryTrigger: trigger.triggered ? "BREAKOUT_RETEST_HOLD_REACCEL" : "NONE",
    invalidationReason: setupState === "INVALIDATED" ? "SETUP_INVALIDATED" : setupState === "EXPIRED" ? "SETUP_EXPIRED" : null,
    suggestedHorizon: "3-30m",
    suggestedRiskProfile: "TREND_FOLLOW",
    suggestedExitProfile: "RETEST_FAIL_EXIT",
    shadowOnly: true,
  };
}

function buildBreakoutProducerContextMissingResult(
  input: StrategyInput,
  regime: RegimeSnapshot,
  ctx: ReturnType<typeof resolveStrategyContext>,
): BreakoutEvaluationResult {
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
    setupId: `${input.candidateId}:breakout-pending`,
    strategyId: "BREAKOUT_RETEST",
    featureSnapshotId: ctx.featureSnapshotId,
    sourceType: input.sourceType,
    marketEventAt: input.marketEventAt,
    evaluatedAt: input.evaluatedAt,
    setupState: "WARMUP",
    referenceLevel: null,
    invalidation: null,
    trigger,
    transition: null,
    economics: buildTradeEconomicsRecord({
      candidateId: input.candidateId,
      strategyId: "BREAKOUT_RETEST",
      featureSnapshotId: ctx.featureSnapshotId,
      costSource: "UNKNOWN",
    }),
    economicsStatus: "UNKNOWN",
    strategyEvaluation,
  };
}

export function evaluateBreakoutRetestStrategy(
  input: StrategyInput,
  regime: RegimeSnapshot,
  strategyContext?: StrategyContextExtension,
): BreakoutEvaluationResult {
  const ctx = resolveStrategyContext(strategyContext ?? input.strategyContext, input);
  if (!ctx.candles.length && !ctx.trades.length) {
    return buildBreakoutProducerContextMissingResult(input, regime, ctx);
  }
  const persistLifecycle = Boolean(ctx.candles.length > 0 || ctx.trades.length > 0);
  const terminalState = persistLifecycle ? getBreakoutSetupState(input.candidateId, ctx.lifecycleId) : "WARMUP";
  const frozen = persistLifecycle ? getFrozenBreakoutLevel(input.candidateId, ctx.lifecycleId) : null;

  const closedCount = ctx.candles.filter((c) => c.closed && c.availableAt <= ctx.nowMs).length;
  const warmupComplete = closedCount >= MIN_CLOSED_CANDLES;

  const referenceLevel = computeConfirmedPivotLevel(ctx.candles, ctx.nowMs);
  const level = frozen?.level ?? referenceLevel.level;
  const frozenLevelVersion = frozen ? "frozen" : referenceLevel.levelVersion;

  let breakoutConfirmed = false;
  let breakoutAtMs: number | null = frozen?.breakoutAtMs ?? null;
  let retestObserved = false;
  let retestAtMs: number | null = null;
  let holdConfirmed = false;
  let invalidated = terminalState === "INVALIDATED";
  let retestPending = false;

  if (level != null && warmupComplete) {
    const levelReadyAtMs = referenceLevel.pivotAtMs > 0 ? referenceLevel.pivotAtMs : 0;
    const breakout =
      breakoutAtMs != null
        ? { confirmed: true, atMs: breakoutAtMs, reasonCode: "BREAKOUT_CLOSE_ABOVE_LEVEL" }
        : findFirstBreakoutAfterLevel(level, ctx.candles, ctx.nowMs, levelReadyAtMs);
    breakoutConfirmed = breakout.confirmed || breakoutAtMs != null;
    if (breakout.confirmed && breakoutAtMs == null) breakoutAtMs = breakout.atMs ?? ctx.nowMs;
    if (breakoutConfirmed && breakoutAtMs != null) {
      const retest = detectRetest(level, ctx.candles, ctx.nowMs, breakoutAtMs);
      if (retest.invalidated) invalidated = true;
      retestObserved = retest.observed;
      if (retest.observed && retest.atMs != null) retestAtMs = retest.atMs;
      retestPending = !retest.observed && !retest.invalidated;
      if (retestObserved && retestAtMs != null) {
        const hold = detectHoldAboveLevel(level, ctx.candles, ctx.nowMs, retestAtMs);
        holdConfirmed = hold.held;
        if (!hold.held && hold.reasonCode === "HOLD_FAILED") invalidated = true;
      }
    }
  }

  const flow = computeFlowFromTrades(ctx.trades, ctx.nowMs);
  const latestClosed = ctx.candles.filter((c) => c.closed && c.availableAt <= ctx.nowMs).at(-1);
  const reaccelerationPct =
    level != null && latestClosed
      ? ((latestClosed.close - level) / level) * 100
      : null;

  const setupCheck = evaluateBreakoutSetupQualification({
    warmupComplete,
    referenceLevel,
    flow,
    breakoutConfirmed,
    retestObserved,
    holdConfirmed,
    invalidated,
  });

  let trigger = evaluateBreakoutEntryTrigger(setupCheck.qualified, flow.value, reaccelerationPct);
  if (!setupCheck.qualified) {
    trigger = {
      ...trigger,
      reasonCodes: [...new Set([...setupCheck.reasonCodes, ...trigger.reasonCodes])],
    };
  }

  const nextGeneration = getBreakoutTriggerGeneration(input.candidateId, ctx.lifecycleId) + 1;
  const existingSignalId = getBreakoutLastSignalId(input.candidateId, ctx.lifecycleId);
  const signalId =
    trigger.triggered
      ? existingSignalId ?? buildSignalId(input.candidateId, ctx.lifecycleId, nextGeneration, ctx.nowMs)
      : null;
  const duplicate = signalId && persistLifecycle
    ? shouldSuppressBreakoutDuplicate(input.candidateId, ctx.lifecycleId, signalId)
    : false;
  if (duplicate) {
    trigger = { ...trigger, triggered: false, reasonCodes: [...trigger.reasonCodes, "DUPLICATE_SIGNAL_SUPPRESSED"] };
  }

  const setupStarted = frozen?.level != null;
  const expired =
    terminalState === "EXPIRED" ||
    (setupStarted && breakoutAtMs != null && ctx.nowMs - breakoutAtMs > POLICY.retestExpireMs && !trigger.triggered);

  const lifecycleTriggerIntent = Boolean(signalId) && (trigger.triggered || duplicate);
  const transition = persistLifecycle
    ? processBreakoutSetupTransition({
        candidateId: input.candidateId,
        lifecycleId: ctx.lifecycleId,
        eventAtMs: ctx.nowMs,
        availableAtMs: ctx.nowMs,
        snapshotReference: ctx.featureSnapshotId,
        warmupComplete,
        levelReady: referenceLevel.quality === "VALID" && referenceLevel.level != null,
        frozenLevel: level,
        frozenLevelVersion,
        breakoutConfirmed,
        retestPending,
        retestObserved,
        holdConfirmed,
        triggerFired: lifecycleTriggerIntent && !expired && !invalidated,
        invalidated,
        expired,
        signalId: lifecycleTriggerIntent ? signalId : null,
        breakoutAtMs,
        retestAtMs,
      })
    : null;

  const setupState: BreakoutSetupState = transition?.newState ?? (
    trigger.triggered ? "TRIGGERED" : setupCheck.qualified ? "HOLD_CONFIRMED" : warmupComplete ? "LEVEL_READY" : "WARMUP"
  );

  if (trigger.triggered && !duplicate && signalId) {
    trigger = {
      ...trigger,
      signalId,
      triggerAt: new Date(ctx.nowMs).toISOString(),
      validUntil: new Date(ctx.nowMs + BREAKOUT_TRIGGER_VALID_MS).toISOString(),
    };
  }

  const legacySetupScore = clamp01(
    (input.breakoutHeld ? 1 : 0) * 0.5 + input.flowRecovery * 0.25 + input.acceleration * 0.25,
  );

  const economicsStatus =
    input.expectedMovePercent > 0 && input.entryFee > 0 && input.expectedMovePercent > computeMinimumViableMove(input)
      ? "KNOWN"
      : "UNKNOWN";
  const economics =
    economicsStatus === "KNOWN"
      ? buildTradeEconomicsRecord({
          candidateId: input.candidateId,
          strategyId: "BREAKOUT_RETEST",
          featureSnapshotId: ctx.featureSnapshotId,
          expectedMovePercent: input.expectedMovePercent,
          expectedMoveSource: "scenario_fixture",
          expectedMoveQuality: "VALID",
          entryPrice: latestClosed?.close ?? null,
          costSource: "CONFIGURED_ASSUMPTION",
          grossMovePct: reaccelerationPct,
        })
      : buildTradeEconomicsRecord({
          candidateId: input.candidateId,
          strategyId: "BREAKOUT_RETEST",
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

  const setupId = transition?.setupId ?? `${input.candidateId}:breakout-pending`;

  return {
    schemaVersion: PR03_SCHEMA_VERSION,
    policyVersion: PR03_POLICY_VERSION,
    candidateId: input.candidateId,
    lifecycleId: ctx.lifecycleId,
    setupId,
    strategyId: "BREAKOUT_RETEST",
    featureSnapshotId: ctx.featureSnapshotId,
    sourceType: input.sourceType,
    marketEventAt: input.marketEventAt,
    evaluatedAt: input.evaluatedAt,
    setupState,
    referenceLevel: level != null ? { ...referenceLevel, level } : referenceLevel,
    invalidation: level != null ? buildInvalidation(level, ctx.nowMs) : null,
    trigger,
    transition,
    economics,
    economicsStatus,
    strategyEvaluation,
  };
}

export { POLICY as BREAKOUT_RETEST_POLICY };
