/**
 * Risk-adjusted performance calibration — improves Sharpe/Sortino via return consistency,
 * not trade-count reduction.
 */
import { resolveRegimePipelinePolicy } from "@/src/server/scanner/regime-intelligence.service";
function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 4) {
  return Number(value.toFixed(decimals));
}

export const RISK_ADJUSTED_POLICY = {
  eliteConfidenceBoost: 1.06,
  minConfidenceForEliteBoost: 82,
  maxRiskForEliteBoost: 68,
  moderateConfidenceVarianceGuard: 0.9,
  moderateConfidenceMin: 72,
  moderateConfidenceMax: 82,
  volatileRegimeVarianceGuard: 0.88,
  volatileRegimeConfidenceCeiling: 78,
  rangingRegimeBoost: 1.03,
  rangingRegimeMinConfidence: 75,
  strategyStabilityFactors: {
    momentum_scalp: 1.03,
    mean_reversion: 1.04,
    trend_pullback: 0.94,
    breakout_follow: 0.86,
  } as Record<string, number>,
  unstableTrendPullbackPenalty: 0.9,
  minMultiplier: 0.78,
  maxMultiplier: 1.08,
} as const;

export type RiskAdjustedMultiplier = {
  multiplier: number;
  factors: Record<string, number>;
};

export function resolveRiskAdjustedNotionalMultiplier(input: {
  confidencePercent: number;
  aiRiskScore: number;
  marketRegime: string;
  strategy: string;
  volatilityPercent: number;
}): RiskAdjustedMultiplier {
  const regimePolicy = resolveRegimePipelinePolicy({
    marketRegime: input.marketRegime,
    volatilityPercent: input.volatilityPercent,
  });
  const strategy = input.strategy.toLowerCase();
  const factors: Record<string, number> = {
    eliteBoost: 1,
    moderateGuard: 1,
    regimeFactor: regimePolicy.sizingRegimeFactor,
    strategyFactor: 1,
    trendPullbackPenalty: 1,
  };

  if (
    input.confidencePercent >= RISK_ADJUSTED_POLICY.minConfidenceForEliteBoost &&
    input.aiRiskScore <= RISK_ADJUSTED_POLICY.maxRiskForEliteBoost
  ) {
    factors.eliteBoost = RISK_ADJUSTED_POLICY.eliteConfidenceBoost;
  } else if (
    input.confidencePercent >= RISK_ADJUSTED_POLICY.moderateConfidenceMin &&
    input.confidencePercent < RISK_ADJUSTED_POLICY.moderateConfidenceMax
  ) {
    factors.moderateGuard = RISK_ADJUSTED_POLICY.moderateConfidenceVarianceGuard;
  }

  if (regimePolicy.institutionalClasses.includes("HIGH_VOLATILITY") && input.confidencePercent < RISK_ADJUSTED_POLICY.volatileRegimeConfidenceCeiling) {
    factors.regimeFactor = Math.min(factors.regimeFactor, RISK_ADJUSTED_POLICY.volatileRegimeVarianceGuard);
  } else if (
    (regimePolicy.institutionalClasses.includes("MEAN_REVERTING") || regimePolicy.canonicalRegime === "RANGE_SIDEWAYS") &&
    input.confidencePercent >= RISK_ADJUSTED_POLICY.rangingRegimeMinConfidence
  ) {
    factors.regimeFactor = Math.max(factors.regimeFactor, RISK_ADJUSTED_POLICY.rangingRegimeBoost);
  }

  factors.strategyFactor =
    RISK_ADJUSTED_POLICY.strategyStabilityFactors[strategy] ??
    RISK_ADJUSTED_POLICY.strategyStabilityFactors.trend_pullback;

  if (
    strategy === "trend_pullback" &&
    regimePolicy.institutionalClasses.includes("TRENDING") &&
    input.confidencePercent >= RISK_ADJUSTED_POLICY.moderateConfidenceMin &&
    input.confidencePercent < RISK_ADJUSTED_POLICY.moderateConfidenceMax
  ) {
    factors.trendPullbackPenalty = RISK_ADJUSTED_POLICY.unstableTrendPullbackPenalty;
  }

  const raw =
    factors.eliteBoost *
    factors.moderateGuard *
    factors.regimeFactor *
    factors.strategyFactor *
    factors.trendPullbackPenalty;

  return {
    multiplier: round(clamp(raw, RISK_ADJUSTED_POLICY.minMultiplier, RISK_ADJUSTED_POLICY.maxMultiplier), 4),
    factors: Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, round(v, 4)])),
  };
}

export type RiskAdjustedMetrics = {
  sharpeRatio: number;
  sortinoRatio: number;
  profitFactor: number;
  expectancy: number;
  volatility: number;
  maxDrawdown: number;
  totalPnl: number;
  tradeCount: number;
  capitalEfficiency: number;
  portfolioStability: number;
};

export function computeRiskAdjustedMetrics(pnls: number[], initialEquity = 10_000): RiskAdjustedMetrics {
  const returns = pnls.map((p) => p / initialEquity);
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length ? returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length : 0;
  const std = Math.sqrt(variance);
  const downside = returns.filter((r) => r < 0);
  const downsideVar = downside.length ? downside.reduce((s, r) => s + r ** 2, 0) / downside.length : 0;
  const downsideStd = Math.sqrt(downsideVar);
  const grossProfit = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0));
  let peak = initialEquity;
  let equity = initialEquity;
  let maxDrawdown = 0;
  for (const pnl of pnls) {
    equity += pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  const winRate = pnls.length ? pnls.filter((p) => p > 0).length / pnls.length : 0;
  const portfolioStability = round(winRate * 100 - (std * 100) * 0.35 - (maxDrawdown / Math.max(initialEquity, 1)) * 100, 4);

  return {
    sharpeRatio: std > 0 ? round(mean / std, 4) : 0,
    sortinoRatio: downsideStd > 0 ? round(mean / downsideStd, 4) : std > 0 ? round(mean / std, 4) : 0,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : grossProfit > 0 ? 999 : 0,
    expectancy: pnls.length ? round(pnls.reduce((a, b) => a + b, 0) / pnls.length, 4) : 0,
    volatility: round(std * 100, 4),
    maxDrawdown: round(maxDrawdown, 4),
    totalPnl: round(pnls.reduce((a, b) => a + b, 0), 4),
    tradeCount: pnls.length,
    capitalEfficiency: round(pnls.reduce((a, b) => a + b, 0) / initialEquity, 4),
    portfolioStability,
  };
}
