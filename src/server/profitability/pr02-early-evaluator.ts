import { createHash } from "node:crypto";
import type { RegimeSnapshot, StrategyEvaluation, StrategyInput } from "@/src/server/forensics/p4-regime-strategy-shadow";
import { computeMinimumViableMove } from "@/src/server/forensics/p4-regime-strategy-shadow";
import { buildTradeEconomicsRecord } from "@/src/server/profitability/pr01-economics";
import { computeEarlyFeatures } from "@/src/server/profitability/pr02-early-features";
import {
  EARLY_SETUP_EXPIRE_MS,
  EARLY_TRIGGER_VALID_MS,
  getEarlySetupState,
  processEarlySetupTransition,
  shouldSuppressDuplicateTrigger,
} from "@/src/server/profitability/pr02-early-setup";
import {
  PR02_POLICY_VERSION,
  PR02_SCHEMA_VERSION,
  type EarlyContextExtension,
  type EarlyEvaluationResult,
  type EarlyExhaustionAssessment,
  type EarlyFeatureSet,
  type EarlyTriggerResult,
} from "@/src/server/profitability/pr02-types";
import type { InvalidationContract } from "@/src/server/profitability/pr03-types";

const POLICY = {
  minPriceReturnShortPct: 0.04,
  minPriceAcceleration: 0.01,
  minFlowImbalance: 0.08,
  minRelativeActivity: 1.1,
  minTradeRateAcceleration: 0.02,
  maxExtensionFromBaselinePct: 2.5,
  maxSpreadBps: 80,
  minDepthCoverage: 0.15,
  spikeReversalReturnPct: -0.12,
} as const;

function featureValue(features: EarlyFeatureSet, key: string): number | null {
  const row = features.features[key];
  if (!row || row.quality !== "VALID") return null;
  return row.value;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(6))));
}

function buildSignalId(candidateId: string, lifecycleId: string, triggerGeneration: number, eventAtMs: number) {
  return createHash("sha256")
    .update(`${candidateId}:${lifecycleId}:${triggerGeneration}:${eventAtMs}`)
    .digest("hex")
    .slice(0, 24);
}

export function buildEarlyStructuralInvalidation(input: {
  baselinePrice: number;
  firstDetectionPrice: number;
  latestPrice: number;
  asOfMs: number;
}): InvalidationContract | null {
  const reference = Math.min(input.baselinePrice, input.firstDetectionPrice);
  if (!Number.isFinite(reference) || reference <= 0) return null;
  if (!Number.isFinite(input.latestPrice) || input.latestPrice <= reference) return null;
  const invalidationThreshold = Number((reference * 0.995).toFixed(8));
  if (invalidationThreshold >= input.latestPrice) return null;
  return {
    referenceLevel: reference,
    invalidationThreshold,
    reasonCode: "EARLY_BASELINE_STRUCTURE_BREACH",
    computedAtMs: input.asOfMs,
    availableAtMs: input.asOfMs,
    validUntilMs: input.asOfMs + EARLY_SETUP_EXPIRE_MS,
    sourceObservations: ["BASELINE_PRICE", "FIRST_DETECTION_PRICE"],
  };
}

function buildProducerContextMissingResult(
  input: StrategyInput,
  regime: RegimeSnapshot,
  ctx: EarlyContextExtension | undefined,
  nowMs: number,
  lifecycleId: string,
): EarlyEvaluationResult {
  const trigger: EarlyTriggerResult = {
    triggered: false,
    signalId: null,
    triggerAt: null,
    validUntil: null,
    reasonCodes: ["PRODUCER_CONTEXT_MISSING"],
    setupQualified: false,
    entryTriggerMet: false,
    rankingScore: 0,
  };
  const features = computeEarlyFeatures({
    symbol: input.candidateId.split(":")[0] ?? input.candidateId,
    candidateId: input.candidateId,
    lifecycleId,
    marketEventAt: input.marketEventAt,
    observedAt: input.evaluatedAt,
    nowMs,
    trades: [],
    book: ctx?.book ?? null,
    baselinePrice: ctx?.baselinePrice ?? 0,
    firstDetectionPrice: ctx?.firstDetectionPrice ?? 0,
    intendedNotional: ctx?.intendedNotional ?? 500,
  });
  const strategyEvaluation = mapToStrategyEvaluation(input, regime, features, trigger, "WARMUP", "UNKNOWN");
  return {
    schemaVersion: PR02_SCHEMA_VERSION,
    policyVersion: PR02_POLICY_VERSION,
    candidateId: input.candidateId,
    lifecycleId,
    strategyId: "EARLY_ACCELERATION",
    featureSnapshotId: ctx?.featureSnapshotId ?? null,
    sourceType: input.sourceType,
    marketEventAt: input.marketEventAt,
    evaluatedAt: input.evaluatedAt,
    setupState: "WARMUP",
    dataValidity: "INSUFFICIENT_DATA",
    universeEligible: true,
    setupQualified: false,
    trigger,
    exhaustion: {
      exhausted: false,
      reasonCodes: [],
      extensionFromBaselinePct: null,
      flowWeakening: false,
      spreadDepthDeteriorating: false,
      spikeReversal: false,
    },
    features,
    transition: null,
    economics: buildTradeEconomicsRecord({
      candidateId: input.candidateId,
      strategyId: "EARLY_ACCELERATION",
      featureSnapshotId: ctx?.featureSnapshotId ?? null,
      costSource: "UNKNOWN",
    }),
    economicsStatus: "UNKNOWN",
    invalidation: null,
    setupId: `${input.candidateId}:early:${lifecycleId}`,
    strategyEvaluation,
  };
}

export function assessEarlyExhaustion(features: EarlyFeatureSet, trades: { price: number }[]): EarlyExhaustionAssessment {
  const extension = featureValue(features, "extensionFromBaselinePct");
  const flowImbalance = featureValue(features, "flowImbalance5s");
  const buyFlowAccel = featureValue(features, "buyFlowAcceleration");
  const spreadBps = featureValue(features, "spreadBps");
  const depthCoverage = featureValue(features, "depthCoverage");
  const priceReturn = featureValue(features, "priceReturnShortPct");
  const reasonCodes: string[] = [];
  const extensionExceeded = extension != null && extension > POLICY.maxExtensionFromBaselinePct;
  const flowWeakening = flowImbalance != null && flowImbalance < 0 && buyFlowAccel != null && buyFlowAccel < 0;
  const spreadDepthDeteriorating =
    (spreadBps != null && spreadBps > POLICY.maxSpreadBps) ||
    (depthCoverage != null && depthCoverage < POLICY.minDepthCoverage);
  const spikeReversal =
    priceReturn != null &&
    priceReturn <= POLICY.spikeReversalReturnPct &&
    trades.length >= 3 &&
    trades[trades.length - 1]!.price < trades[trades.length - 3]!.price;
  if (extensionExceeded) reasonCodes.push("EXTENSION_FROM_BASELINE");
  if (flowWeakening) reasonCodes.push("FLOW_WEAKENING");
  if (spreadDepthDeteriorating) reasonCodes.push("SPREAD_DEPTH_DETERIORATING");
  if (spikeReversal) reasonCodes.push("SPIKE_REVERSAL");
  return {
    exhausted: reasonCodes.length > 0,
    reasonCodes,
    extensionFromBaselinePct: extension,
    flowWeakening,
    spreadDepthDeteriorating,
    spikeReversal,
  };
}

export function evaluateEarlySetupQualification(features: EarlyFeatureSet): { qualified: boolean; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  const producerTradeMode = features.coverage.tradeCount > 0;
  if (!features.coverage.warmupComplete) {
    reasonCodes.push("WARMUP_INCOMPLETE");
    return { qualified: false, reasonCodes };
  }
  if (features.missingRequired.length > 0) {
    reasonCodes.push("MISSING_REQUIRED_FEATURES");
    return { qualified: false, reasonCodes };
  }
  const insufficient = ["priceReturnShortPct", "priceAcceleration", "tradeRate5s", "flowImbalance5s", "spreadBps", "depthCoverage"]
    .filter((key) => features.features[key]?.quality === "INSUFFICIENT_DATA");
  if (insufficient.length > 0) {
    reasonCodes.push("INSUFFICIENT_FEATURE_COVERAGE");
    return { qualified: false, reasonCodes };
  }
  if (features.invalidFeatures.length > 0) {
    reasonCodes.push("INVALID_FEATURES");
    return { qualified: false, reasonCodes };
  }
  if (features.staleFeatures.length > 0) {
    reasonCodes.push("STALE_FEATURES");
    return { qualified: false, reasonCodes };
  }
  const priceReturn = featureValue(features, "priceReturnShortPct");
  const priceAccel = featureValue(features, "priceAcceleration");
  const flow = featureValue(features, "flowImbalance5s");
  const relativeActivity = featureValue(features, "relativeActivity");
  const tradeAccel = featureValue(features, "tradeRateAcceleration");
  if (priceReturn == null || priceReturn < POLICY.minPriceReturnShortPct) reasonCodes.push("PRICE_MOVE_WEAK");
  if (priceAccel == null || priceAccel < POLICY.minPriceAcceleration) reasonCodes.push("PRICE_ACCEL_WEAK");
  const flowConfirmed = flow != null && flow >= POLICY.minFlowImbalance;
  const activityConfirmed =
    (relativeActivity != null && relativeActivity >= POLICY.minRelativeActivity) ||
    (tradeAccel != null && tradeAccel >= POLICY.minTradeRateAcceleration);
  if (producerTradeMode) {
    if (!flowConfirmed) reasonCodes.push("FLOW_ACTIVITY_UNCONFIRMED");
  } else if (!flowConfirmed && !activityConfirmed) {
    reasonCodes.push("FLOW_ACTIVITY_UNCONFIRMED");
  }
  return { qualified: reasonCodes.length === 0, reasonCodes };
}

export function evaluateEarlyEntryTrigger(
  features: EarlyFeatureSet,
  setupQualified: boolean,
  exhausted: boolean,
): EarlyTriggerResult {
  const reasonCodes: string[] = [];
  if (!setupQualified) reasonCodes.push("SETUP_NOT_QUALIFIED");
  if (exhausted) reasonCodes.push("MOVE_EXHAUSTED");
  const priceReturn = featureValue(features, "priceReturnShortPct");
  const flow = featureValue(features, "flowImbalance5s");
  const priceAccel = featureValue(features, "priceAcceleration");
  const entryTriggerMet =
    setupQualified &&
    !exhausted &&
    priceReturn != null &&
    priceReturn >= POLICY.minPriceReturnShortPct &&
    priceAccel != null &&
    priceAccel > 0 &&
    flow != null &&
    flow >= POLICY.minFlowImbalance;
  if (!entryTriggerMet && setupQualified && !exhausted) reasonCodes.push("ENTRY_TRIGGER_NOT_MET");
  const rankingScore = clamp01(
    ((priceReturn ?? 0) / 2) * 0.25 +
      ((flow ?? 0) + 1) / 2 * 0.25 +
      ((priceAccel ?? 0) + 1) / 2 * 0.2 +
      (featureValue(features, "relativeActivity") ?? 0) / 3 * 0.15 +
      (featureValue(features, "depthCoverage") ?? 0) * 0.15,
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
  features: EarlyFeatureSet,
  trigger: EarlyTriggerResult,
  setupState: string,
  economicsStatus: EarlyEvaluationResult["economicsStatus"],
): StrategyEvaluation {
  const reasons: string[] = [];
  const missingAll = new Set(input.missingFeatures ?? []);
  const earlyRequired = [
    "expectedMovePercent",
    "entrySpread",
    "entrySlippage",
    "entryFee",
    "exitSpread",
    "exitSlippage",
    "exitFee",
    "liquidityScore",
    "marketEventAt",
    "velocity",
    "acceleration",
    "volumeAcceleration",
    "relativeStrength",
  ];
  const missingFeatures = earlyRequired.filter((key) => missingAll.has(key) || features.missingRequired.includes(key));
  const staleFeatures = [...new Set([...(input.staleFeatures ?? []), ...features.staleFeatures])];
  const invalidFeatures = [...new Set([...(input.invalidFeatures ?? []), ...features.invalidFeatures])];
  const minimumViableMovePercent = computeMinimumViableMove(input);
  const regimeCompatibility =
    regime.regime === "BULL_TREND" || regime.regime === "TRANSITION" || regime.regime === "LOW_VOLATILITY" ? 0.85 : 0.25;
  const legacySetupScore = clamp01(
    (input.velocity + input.acceleration + input.volumeAcceleration + input.relativeStrength) / 4,
  );
  const setupQuality = trigger.setupQualified ? Math.max(trigger.rankingScore, legacySetupScore) : trigger.rankingScore;
  const entryTimingQuality = trigger.entryTriggerMet ? clamp01(1 - Math.max(0, (features.features.extensionFromBaselinePct?.value ?? 0) / POLICY.maxExtensionFromBaselinePct)) : 0.2;
  const spreadBps = featureValue(features, "spreadBps") ?? input.spreadBps;
  const depthCoverage = featureValue(features, "depthCoverage") ?? input.liquidityScore;
  const executionQuality = clamp01((depthCoverage + (1 - spreadBps / 100)) / 2);
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
    evaluationId: `${input.candidateId}:EARLY_ACCELERATION:${PR02_POLICY_VERSION}`,
    candidateId: input.candidateId,
    strategyId: "EARLY_ACCELERATION",
    policyVersion: PR02_POLICY_VERSION,
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
    entryTrigger: trigger.triggered ? "EARLY_ACCELERATION_FLOW_CONFIRMED" : "NONE",
    invalidationReason: setupState === "INVALIDATED" ? "SETUP_INVALIDATED" : setupState === "EXPIRED" ? "SETUP_EXPIRED" : null,
    suggestedHorizon: "3-15m",
    suggestedRiskProfile: "TREND_FOLLOW",
    suggestedExitProfile: "STANDARD",
    shadowOnly: true,
  };
}

export function evaluateEarlyAccelerationStrategy(
  input: StrategyInput,
  regime: RegimeSnapshot,
  earlyContext?: EarlyContextExtension,
): EarlyEvaluationResult {
  const ctx = earlyContext ?? input.earlyContext;
  const nowMs = ctx?.nowMs ?? Date.parse(input.evaluatedAt);
  const lifecycleId = ctx?.lifecycleId ?? input.candidateId;
  const trades = ctx?.trades ?? [];
  if (!trades.length) {
    return buildProducerContextMissingResult(input, regime, ctx, nowMs, lifecycleId);
  }
  const persistLifecycle = true;
  const terminalState = persistLifecycle ? getEarlySetupState(input.candidateId, lifecycleId) : "OBSERVING";
  const features = computeEarlyFeatures({
    symbol: input.candidateId.split(":")[0] ?? input.candidateId,
    candidateId: input.candidateId,
    lifecycleId,
    marketEventAt: input.marketEventAt,
    observedAt: input.evaluatedAt,
    nowMs,
    trades,
    book: ctx?.book ?? null,
    baselinePrice: ctx?.baselinePrice ?? ctx?.firstDetectionPrice ?? trades[0]?.price ?? 0,
    firstDetectionPrice: ctx?.firstDetectionPrice ?? trades[0]?.price ?? 0,
    intendedNotional: ctx?.intendedNotional ?? 500,
  });

  const setupCheck = evaluateEarlySetupQualification(features);
  const exhaustion = assessEarlyExhaustion(features, trades);
  let trigger = evaluateEarlyEntryTrigger(features, setupCheck.qualified, exhaustion.exhausted);

  const triggerGeneration = 1;
  const signalId = trigger.triggered
    ? buildSignalId(input.candidateId, lifecycleId, triggerGeneration, nowMs)
    : null;
  const duplicate = signalId && persistLifecycle ? shouldSuppressDuplicateTrigger(input.candidateId, lifecycleId, signalId) : false;
  if (duplicate) {
    trigger = { ...trigger, triggered: false, reasonCodes: [...trigger.reasonCodes, "DUPLICATE_SIGNAL_SUPPRESSED"] };
  }

  const armedAtMs = nowMs - 5_000;
  const expired =
    terminalState === "EXPIRED" ||
    (armedAtMs > 0 && nowMs - armedAtMs > EARLY_SETUP_EXPIRE_MS && !trigger.triggered);
  const lifecycleTriggerIntent = Boolean(signalId) && (trigger.triggered || duplicate);
  const transition = persistLifecycle
    ? processEarlySetupTransition({
        candidateId: input.candidateId,
        lifecycleId,
        eventAtMs: nowMs,
        availableAtMs: nowMs,
        snapshotReference: ctx?.featureSnapshotId ?? null,
        warmupComplete: features.coverage.warmupComplete,
        setupQualified: setupCheck.qualified && terminalState !== "EXPIRED" && terminalState !== "INVALIDATED",
        triggerFired: lifecycleTriggerIntent && terminalState !== "EXPIRED" && terminalState !== "INVALIDATED",
        invalidated: exhaustion.exhausted || terminalState === "INVALIDATED",
        expired,
        signalId: lifecycleTriggerIntent ? signalId : null,
      })
    : {
        candidateId: input.candidateId,
        lifecycleId,
        strategyId: "EARLY_ACCELERATION" as const,
        policyVersion: PR02_POLICY_VERSION,
        eventAt: new Date(nowMs).toISOString(),
        availableAt: new Date(nowMs).toISOString(),
        previousState: "OBSERVING" as const,
        newState: (trigger.triggered ? "TRIGGERED" : setupCheck.qualified ? "ARMED" : features.coverage.warmupComplete ? "OBSERVING" : "WARMUP") as import("@/src/server/profitability/pr02-types").EarlySetupState,
        reasonCode: trigger.triggered ? "ENTRY_TRIGGER_FIRED" : setupCheck.qualified ? "SETUP_ARMED" : "OBSERVING",
        snapshotReference: ctx?.featureSnapshotId ?? null,
        signalId: trigger.triggered ? signalId : null,
        triggerGeneration: trigger.triggered ? 1 : 0,
      };

  if (trigger.triggered && !duplicate && signalId) {
    trigger = {
      ...trigger,
      signalId,
      triggerAt: new Date(nowMs).toISOString(),
      validUntil: new Date(nowMs + EARLY_TRIGGER_VALID_MS).toISOString(),
    };
  }

  const latestPrice = trades.at(-1)?.price ?? ctx?.baselinePrice ?? 0;
  let invalidation = trigger.triggered
    ? buildEarlyStructuralInvalidation({
        baselinePrice: ctx?.baselinePrice ?? latestPrice,
        firstDetectionPrice: ctx?.firstDetectionPrice ?? latestPrice,
        latestPrice,
        asOfMs: nowMs,
      })
    : null;
  if (trigger.triggered && !invalidation) {
    trigger = {
      ...trigger,
      triggered: false,
      signalId: null,
      triggerAt: null,
      validUntil: null,
      reasonCodes: [...trigger.reasonCodes, "INVALIDATION_STRUCTURE_MISSING"],
    };
  }

  const setupId = `${input.candidateId}:early:${lifecycleId}`;

  const economicsStatus: EarlyEvaluationResult["economicsStatus"] =
    input.expectedMovePercent > 0 && input.entryFee > 0 && input.expectedMovePercent > computeMinimumViableMove(input)
      ? "KNOWN"
      : "UNKNOWN";
  const economics =
    economicsStatus === "KNOWN"
      ? buildTradeEconomicsRecord({
          candidateId: input.candidateId,
          strategyId: "EARLY_ACCELERATION",
          featureSnapshotId: ctx?.featureSnapshotId ?? null,
          expectedMovePercent: input.expectedMovePercent,
          expectedMoveSource: "scenario_fixture",
          expectedMoveQuality: "VALID",
          entryPrice: trades[trades.length - 1]?.price ?? null,
          intendedQuantity: ctx?.intendedNotional ? ctx.intendedNotional / Math.max(trades[trades.length - 1]?.price ?? 1, 1) : null,
          takerFeeRate: input.entryFee / 100,
          costSource: input.entryFee > 0 ? "CONFIGURED_ASSUMPTION" : "UNKNOWN",
          grossMovePct: featureValue(features, "priceReturnShortPct"),
        })
      : buildTradeEconomicsRecord({
          candidateId: input.candidateId,
          strategyId: "EARLY_ACCELERATION",
          featureSnapshotId: ctx?.featureSnapshotId ?? null,
          costSource: "UNKNOWN",
        });

  const dataValidity =
    features.coverage.warmupComplete
      ? features.staleFeatures.length > 0
        ? "STALE"
        : features.invalidFeatures.length > 0
          ? "INVALID"
          : features.missingRequired.length > 0
            ? "INSUFFICIENT_DATA"
            : "VALID"
      : "WARMUP";

  const strategyEvaluation = mapToStrategyEvaluation(
    input,
    regime,
    features,
    trigger,
    transition.newState,
    economicsStatus,
  );

  return {
    schemaVersion: PR02_SCHEMA_VERSION,
    policyVersion: PR02_POLICY_VERSION,
    candidateId: input.candidateId,
    lifecycleId,
    strategyId: "EARLY_ACCELERATION",
    featureSnapshotId: ctx?.featureSnapshotId ?? null,
    sourceType: input.sourceType,
    marketEventAt: input.marketEventAt,
    evaluatedAt: input.evaluatedAt,
    setupState: transition.newState,
    dataValidity,
    universeEligible: true,
    setupQualified: setupCheck.qualified,
    trigger,
    exhaustion,
    features,
    transition,
    economics,
    economicsStatus,
    invalidation,
    setupId,
    strategyEvaluation,
  };
}

export { POLICY as EARLY_ACCELERATION_POLICY };
