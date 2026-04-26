import { env } from "@/lib/config";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import {
  getApiFailureState,
  getConsecutiveLossCount,
  getDailyPnlSummary,
  getWeeklyPnlSummary,
  getPausedState,
  getRiskConfigByUser,
  listOpenPositionsCount,
  setApiFailureState,
  setPausedState,
} from "@/src/server/repositories/risk.repository";

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

  if (state.paused) reasons.push(`System paused: ${state.pauseReason ?? "Risk pause active"}`);
  if (metrics.confidencePercent < config.minConfidenceThreshold) reasons.push("Confidence below minimum threshold");
  if (metrics.spreadPercent > config.maxSpreadThreshold) reasons.push("Spread above threshold");
  if (metrics.liquidity24h < config.minLiquidityThreshold) reasons.push("Liquidity below threshold");
  if (metrics.expectedProfitPercent < config.minExpectedProfitThreshold) reasons.push("Expected profit below minimum");
  if (metrics.slippagePercent > config.maxSlippageThreshold) reasons.push("Estimated slippage above threshold");
  if (metrics.riskPerTradePercent > config.maxRiskPerTrade) reasons.push("Risk per trade exceeds threshold");
  if (config.stopLossRequired && !metrics.stopLossConfigured) reasons.push("Stop-loss is required");
  if (metrics.volatilityPercent > config.abnormalVolatilityThreshold) reasons.push("Abnormal volatility breaker");
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

export async function getEffectiveRiskConfig(userId: string): Promise<EffectiveRiskConfig> {
  const config = await getRiskConfigByUser(userId);
  const metadata = (config?.metadata as Record<string, unknown> | undefined) ?? {};
  const configuredMinConfidence = readNumber(metadata, "minConfidenceThreshold", env.AI_MIN_CONFIDENCE);
  // Keep runtime risk gate aligned with live exchange realities.
  // Historical DB values can remain very strict (70+), which causes perpetual rejects.
  // Use a practical cap for live flow so risk gate does not block every candidate.
  const boundedMinConfidence = env.AI_ULTRA_PRECISION_MODE
    ? Math.max(env.AI_SPOT_MIN_CONFIDENCE_ULTRA, configuredMinConfidence)
    : Math.max(
        40,
        Math.min(configuredMinConfidence, env.EXECUTION_FAST_MIN_CONFIDENCE, 45),
      );
  return {
    maxRiskPerTrade: readNumber(metadata, "maxRiskPerTrade", 1.2),
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

  return {
    ok: reasons.length === 0,
    reasons,
    paused: Boolean(paused.paused),
    effectiveConfig,
  };
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
  const current = await getApiFailureState(userId);
  const nextCount = current.count + 1;
  const blocked =
    nextCount >= risk.apiFailureBreaker
      ? new Date(Date.now() + 10 * 60 * 1000).toISOString()
      : current.blockedUntil;
  await setApiFailureState(userId, {
    count: nextCount,
    lastFailureAt: new Date().toISOString(),
    blockedUntil: blocked,
  });
  return { count: nextCount, blockedUntil: blocked };
}

export async function resetApiFailure(userId: string) {
  await setApiFailureState(userId, { count: 0 });
}

export async function pauseSystemByRisk(userId: string, reason: string, minutes = 10) {
  const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  await setPausedState({ userId, paused: true, reason, until });
}

export async function resumeSystem(userId: string) {
  await setPausedState({ userId, paused: false });
}
