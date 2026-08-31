import { env } from "@/lib/config";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import { resolveRegimePipelinePolicy } from "@/src/server/scanner/regime-intelligence.service";
import {
  getApiFailureState,
  getApiFailureStateByDomain,
  getConsecutiveLossCount,
  getDailyPnlSummary,
  getWeeklyPnlSummary,
  getPausedState,
  getRiskConfigByUser,
  listOpenPositionsCount,
  type ApiFailureDomain,
  setApiFailureState,
  setPausedState,
} from "@/src/server/repositories/risk.repository";
import { bridgeRiskSizing } from "@/src/server/forensics/forensic-bridge.service";
import { createCandidateId } from "@/src/server/forensics/forensic-collector.service";

/** Stable Risk Gate policy contract for API/status consumers (Task 001-4). */
export const RISK_GATE_POLICY = {
  consecutiveLossBlocksEntry: false,
  consecutiveLossTelemetryOnly: true,
  apiBreakerUsesCooldownWindow: true,
  preTradeEvaluationRequired: true,
  /** Small risk-per-trade relief for high-confidence, low-risk-score setups only. */
  maxRiskPerTradeBumpPercent: 0.15,
  minConfidenceForRiskPerTradeRelief: 72,
  maxAiRiskScoreForRiskPerTradeRelief: 45,
} as const;

type EffectiveRiskConfig = {
  maxRiskPerTrade: number;
  maxDailyLossPercent: number;
  maxWeeklyLossPercent: number;
  dailyLossReferenceTry: number;
  weeklyLossReferenceTry: number;
  maxOpenPositions: number;
  minConfidenceThreshold: number;
  maxSpreadThreshold: number;
  minLiquidityThreshold: number;
  minExpectedProfitThreshold: number;
  maxSlippageThreshold: number;
  cooldownMinutes: number;
  consecutiveLossBreaker: number;
  apiFailureBreaker: number;
  abnormalVolatilityThreshold: number;
  emergencyBrakeEnabled: boolean;
  stopLossRequired: boolean;
};

export type PreTradeRiskInput = {
  userId: string;
  symbol: string;
  confidencePercent: number;
  spreadPercent: number;
  liquidity24h: number;
  expectedProfitPercent: number;
  slippagePercent: number;
  volatilityPercent: number;
  riskPerTradePercent: number;
  stopLossConfigured?: boolean;
};

export type RiskGateResult = {
  ok: boolean;
  reasons: string[];
  paused: boolean;
  effectiveConfig: EffectiveRiskConfig;
};

export function evaluateRiskRules(input: {
  config: EffectiveRiskConfig;
  metrics: {
    confidencePercent: number;
    spreadPercent: number;
    liquidity24h: number;
    expectedProfitPercent: number;
    slippagePercent: number;
    volatilityPercent: number;
    riskPerTradePercent: number;
    stopLossConfigured?: boolean;
    aiRiskScore?: number;
    marketRegime?: string;
  };
  state: {
    paused: boolean;
    pauseReason?: string;
    openPositionCount: number;
    dailyLossAbs: number;
    dailyLossPercent: number;
    weeklyLossAbs: number;
    weeklyLossPercent: number;
    consecutiveLosses: number;
    apiFailureCount: number;
    apiBlockedUntil?: string;
  };
}) {
  const reasons: string[] = [];
  const { config, metrics, state } = input;
  const regimePolicy = resolveRegimePipelinePolicy({
    marketRegime: metrics.marketRegime ?? "RANGE_SIDEWAYS",
    volatilityPercent: metrics.volatilityPercent,
    liquidity24h: metrics.liquidity24h,
    minLiquidityThreshold: config.minLiquidityThreshold,
  });
  const effectiveMinConfidence = config.minConfidenceThreshold + regimePolicy.confidenceFloorAdjust;
  const effectiveMinExpectedProfit = config.minExpectedProfitThreshold * regimePolicy.expectedValueFloorMultiplier;
  const effectiveVolatilityBreaker =
    config.abnormalVolatilityThreshold * regimePolicy.volatilityBreakerMultiplier;

  if (state.paused) reasons.push(`System paused: ${state.pauseReason ?? "Risk pause active"}`);
  if (metrics.confidencePercent < effectiveMinConfidence) reasons.push("Confidence below minimum threshold");
  if (metrics.spreadPercent > config.maxSpreadThreshold) reasons.push("Spread above threshold");
  if (metrics.liquidity24h < config.minLiquidityThreshold) reasons.push("Liquidity below threshold");
  if (metrics.expectedProfitPercent < effectiveMinExpectedProfit) reasons.push("Expected profit below minimum");
  if (metrics.slippagePercent > config.maxSlippageThreshold) reasons.push("Estimated slippage above threshold");
  const effectiveMaxRiskPerTrade = boundMaxRiskPerTrade(config.maxRiskPerTrade, {
    confidencePercent: metrics.confidencePercent,
    riskPerTradePercent: metrics.riskPerTradePercent,
    aiRiskScore: metrics.aiRiskScore,
  });
  if (metrics.riskPerTradePercent > effectiveMaxRiskPerTrade) reasons.push("Risk per trade exceeds threshold");
  if (config.stopLossRequired && !metrics.stopLossConfigured) reasons.push("Stop-loss is required");
  if (metrics.volatilityPercent > effectiveVolatilityBreaker) reasons.push("Abnormal volatility breaker");
  if (!regimePolicy.openTradeAllowed) reasons.push(`Market regime blocks entry (${regimePolicy.canonicalRegime})`);
  if (state.openPositionCount >= config.maxOpenPositions) reasons.push(`Max open positions reached (${config.maxOpenPositions})`);
  if (
    state.dailyLossPercent > 0 &&
    state.dailyLossPercent >= config.maxDailyLossPercent &&
    state.dailyLossAbs >= 10
  ) {
    reasons.push("Max daily loss breaker");
  }
  if (
    state.weeklyLossPercent > 0 &&
    state.weeklyLossPercent >= config.maxWeeklyLossPercent &&
    state.weeklyLossAbs >= 20
  ) {
    reasons.push("Max weekly loss breaker");
  }
  // Consecutive loss is tracked as telemetry; do not hard-block new trades.
  // Hard pausing on every loss streak can keep the system stuck in reject loop.
  // Do not block forever by stale failure count; only enforce while cooldown is active.
  if (state.apiBlockedUntil && new Date(state.apiBlockedUntil).getTime() > Date.now()) {
    reasons.push("API breaker cooldown active");
  }
  return reasons;
}

function readNumber(meta: Record<string, unknown> | undefined, key: string, fallback: number) {
  const raw = meta?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

/** Caps stale DB min-confidence so live flow is not stuck in perpetual rejects (Task 001-3). */
export function boundMinConfidenceThreshold(configuredMinConfidence: number): number {
  if (env.AI_ULTRA_PRECISION_MODE) {
    return Math.max(env.AI_SPOT_MIN_CONFIDENCE_ULTRA, configuredMinConfidence);
  }
  const liveConfidenceCap = Math.min(env.EXECUTION_FAST_MIN_CONFIDENCE, 45);
  return Math.max(40, Math.min(configuredMinConfidence, liveConfidenceCap));
}

/** Confidence-calibrated risk-per-trade ceiling — elite setups only, not a global relax. */
export function boundMaxRiskPerTrade(
  configuredMax: number,
  metrics: { confidencePercent: number; riskPerTradePercent: number; aiRiskScore?: number },
): number {
  const aiRisk = metrics.aiRiskScore ?? 100;
  if (
    metrics.confidencePercent >= RISK_GATE_POLICY.minConfidenceForRiskPerTradeRelief &&
    aiRisk <= RISK_GATE_POLICY.maxAiRiskScoreForRiskPerTradeRelief &&
    metrics.riskPerTradePercent <= configuredMax + RISK_GATE_POLICY.maxRiskPerTradeBumpPercent
  ) {
    return configuredMax + RISK_GATE_POLICY.maxRiskPerTradeBumpPercent;
  }
  return configuredMax;
}

export async function getEffectiveRiskConfig(userId: string): Promise<EffectiveRiskConfig> {
  const config = await getRiskConfigByUser(userId);
  const metadata = (config?.metadata as Record<string, unknown> | undefined) ?? {};
  const configuredMinConfidence = readNumber(metadata, "minConfidenceThreshold", env.AI_MIN_CONFIDENCE);
  const boundedMinConfidence = boundMinConfidenceThreshold(configuredMinConfidence);
  return {
    maxRiskPerTrade: readNumber(metadata, "maxRiskPerTrade", 1),
    maxDailyLossPercent: config?.maxDailyLossPercent ?? env.RISK_MAX_DAILY_LOSS_PERCENT,
    maxWeeklyLossPercent: readNumber(metadata, "maxWeeklyLossPercent", env.RISK_MAX_WEEKLY_LOSS_PERCENT),
    dailyLossReferenceTry: readNumber(metadata, "dailyLossReferenceTry", env.RISK_TOTAL_CAPITAL_TRY),
    weeklyLossReferenceTry: readNumber(metadata, "weeklyLossReferenceTry", env.RISK_TOTAL_CAPITAL_TRY),
    maxOpenPositions: config?.maxOpenPositions ?? env.EXECUTION_MAX_OPEN_POSITIONS,
    minConfidenceThreshold: boundedMinConfidence,
    maxSpreadThreshold: readNumber(metadata, "maxSpreadThreshold", env.SCANNER_MAX_SPREAD_PERCENT),
    minLiquidityThreshold: readNumber(metadata, "minLiquidityThreshold", env.SCANNER_MIN_VOLUME_24H),
    minExpectedProfitThreshold: readNumber(metadata, "minExpectedProfitThreshold", 0.2),
    maxSlippageThreshold: readNumber(metadata, "maxSlippageThreshold", 0.45),
    cooldownMinutes: config?.cooldownMinutes ?? 30,
    consecutiveLossBreaker: readNumber(metadata, "consecutiveLossBreaker", 3),
    apiFailureBreaker: readNumber(metadata, "apiFailureBreaker", 4),
    abnormalVolatilityThreshold: readNumber(metadata, "abnormalVolatilityThreshold", 3.2),
    emergencyBrakeEnabled: config?.emergencyBrakeEnabled ?? true,
    stopLossRequired: config?.stopLossRequired ?? true,
  };
}

export async function evaluatePreTradeRisk(input: PreTradeRiskInput): Promise<RiskGateResult> {
  const effectiveConfig = await getEffectiveRiskConfig(input.userId);
  const paused = await getPausedState(input.userId);

  const [daily, weekly, openPositionCount, consecutiveLosses, apiFailures] = await Promise.all([
    getDailyPnlSummary(input.userId),
    getWeeklyPnlSummary(input.userId),
    listOpenPositionsCount(input.userId),
    getConsecutiveLossCount(input.userId),
    getApiFailureState(input.userId),
  ]);
  const reasons = evaluateRiskRules({
    config: effectiveConfig,
    metrics: {
      confidencePercent: input.confidencePercent,
      spreadPercent: input.spreadPercent,
      liquidity24h: input.liquidity24h,
      expectedProfitPercent: input.expectedProfitPercent,
      slippagePercent: input.slippagePercent,
      volatilityPercent: input.volatilityPercent,
      riskPerTradePercent: input.riskPerTradePercent,
      stopLossConfigured: input.stopLossConfigured,
    },
    state: {
      paused: paused.paused,
      pauseReason: paused.reason,
      openPositionCount,
      dailyLossAbs: daily.lossAmountAbs,
      dailyLossPercent:
        effectiveConfig.dailyLossReferenceTry > 0
          ? Number(((daily.lossAmountAbs / effectiveConfig.dailyLossReferenceTry) * 100).toFixed(4))
          : 0,
      weeklyLossAbs: weekly.lossAmountAbs,
      weeklyLossPercent:
        effectiveConfig.weeklyLossReferenceTry > 0
          ? Number(((weekly.lossAmountAbs / effectiveConfig.weeklyLossReferenceTry) * 100).toFixed(4))
          : 0,
      consecutiveLosses,
      apiFailureCount: apiFailures.count,
      apiBlockedUntil: apiFailures.blockedUntil,
    },
  });

  const result = {
    ok: reasons.length === 0,
    reasons,
    paused: Boolean(paused.paused),
    effectiveConfig,
  };
  bridgeRiskSizing({
    candidateId: createCandidateId(input.symbol, "risk"),
    symbol: input.symbol,
    approved: result.ok && !result.paused,
    rejectionReason: result.paused ? paused.reason ?? "Risk paused" : reasons[0],
    riskParameters: {
      openPositionCount,
      consecutiveLosses,
      dailyLossAbs: daily.lossAmountAbs,
      weeklyLossAbs: weekly.lossAmountAbs,
    },
    maxSimultaneousPositions: effectiveConfig.maxOpenPositions,
  });
  return result;
}

export async function evaluateRuntimeRisk(input: { userId: string; symbol: string }) {
  const effectiveConfig = await getEffectiveRiskConfig(input.userId);
  const paused = await getPausedState(input.userId);
  if (paused.paused) {
    return {
      shouldClose: true,
      reason: "RISK_BREAKER" as const,
      message: paused.reason ?? "System paused",
      pauseSystem: true,
    };
  }

  const context = await buildMarketContext(input.symbol);
  if (context.volatilityPercent > effectiveConfig.abnormalVolatilityThreshold) {
    return {
      shouldClose: true,
      reason: "RISK_BREAKER" as const,
      message: "Abnormal volatility breaker",
      pauseSystem: true,
    };
  }
  // Runtime spread/liquidity swings can be temporary; do not force-close early.
  // Position timeout/tp-sl already manages normal exits.
  return { shouldClose: false as const, pauseSystem: false };
}

export async function registerApiFailure(userId: string) {
  const risk = await getEffectiveRiskConfig(userId);
  const current = await getApiFailureStateByDomain(userId, "EXECUTION");
  const nextCount = current.count + 1;
  const blocked =
    nextCount >= risk.apiFailureBreaker
      ? new Date(Date.now() + 10 * 60 * 1000).toISOString()
      : current.blockedUntil;
  await setApiFailureState(
    userId,
    {
      count: nextCount,
      consecutiveFailures: current.consecutiveFailures + 1,
      lastFailureAt: new Date().toISOString(),
      blockedUntil: blocked,
      openUntil: blocked,
      state: blocked ? "OPEN" : "CLOSED",
      lastFailureCode: "UNSPECIFIED",
      lastFailureMessage: "Execution/API failure",
      resetCount: current.resetCount,
    },
    "EXECUTION",
  );
  return { count: nextCount, blockedUntil: blocked };
}

export async function registerDomainApiFailure(input: {
  userId: string;
  domain: ApiFailureDomain;
  reasonCode: string;
  reasonMessage: string;
  cooldownMs?: number;
}) {
  const risk = await getEffectiveRiskConfig(input.userId);
  const current = await getApiFailureStateByDomain(input.userId, input.domain);
  const nextCount = current.count + 1;
  const now = Date.now();
  const timeoutMs = Math.max(5_000, Math.min(input.cooldownMs ?? 10 * 60 * 1000, 30 * 60 * 1000));
  const blocked =
    nextCount >= risk.apiFailureBreaker
      ? new Date(now + timeoutMs).toISOString()
      : current.blockedUntil;
  await setApiFailureState(
    input.userId,
    {
      count: nextCount,
      consecutiveFailures: current.consecutiveFailures + 1,
      lastFailureAt: new Date(now).toISOString(),
      blockedUntil: blocked,
      openUntil: blocked,
      state: blocked ? "OPEN" : "CLOSED",
      lastFailureCode: input.reasonCode,
      lastFailureMessage: input.reasonMessage.slice(0, 300),
      resetCount: current.resetCount,
    },
    input.domain,
  );
  return { count: nextCount, blockedUntil: blocked };
}

export async function resetApiFailure(userId: string) {
  const current = await getApiFailureStateByDomain(userId, "EXECUTION");
  await setApiFailureState(
    userId,
    {
      count: 0,
      consecutiveFailures: 0,
      state: "CLOSED",
      lastSuccessAt: new Date().toISOString(),
      resetCount: current.resetCount + 1,
      blockedUntil: undefined,
      openUntil: undefined,
    },
    "EXECUTION",
  );
}

export async function resetDomainApiFailure(userId: string, domain: ApiFailureDomain) {
  const current = await getApiFailureStateByDomain(userId, domain);
  await setApiFailureState(
    userId,
    {
      count: 0,
      consecutiveFailures: 0,
      state: "CLOSED",
      lastSuccessAt: new Date().toISOString(),
      resetCount: current.resetCount + 1,
      blockedUntil: undefined,
      openUntil: undefined,
    },
    domain,
  );
}

export async function pauseSystemByRisk(userId: string, reason: string, minutes = 10) {
  const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  await setPausedState({ userId, paused: true, reason, until });
}

export async function resumeSystem(userId: string) {
  await setPausedState({ userId, paused: false });
}
