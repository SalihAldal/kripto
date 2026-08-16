import { env } from "@/lib/config";
import { resolvePortfolioAllocationPolicy } from "@/src/server/execution/portfolio-allocation-intelligence.service";
import { resolveRiskAdjustedNotionalMultiplier } from "@/src/server/execution/risk-adjusted-performance.service";
import type { PortfolioAllocationTelemetry } from "@/src/server/execution/portfolio-allocation-intelligence.service";
import { smartPortfolioManager } from "@/src/server/trading-core/portfolio/portfolio-manager";
import type { PortfolioPositionInput } from "@/src/server/trading-core/portfolio/portfolio-types";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 4) {
  return Number(value.toFixed(decimals));
}

/** Risk efficiency policy — capital efficiency without global risk reduction or trade blocking. */
export const RISK_EFFICIENCY_POLICY = {
  volatilityTargetPercent: 2.5,
  minNotionalMultiplier: 0.72,
  maxNotionalMultiplier: 1.08,
  consecutiveLossDecay: 0.9,
  maxConsecutiveLossDecay: 0.62,
  drawdownSoftLimitPercent: 8,
  drawdownSoftMultiplierFloor: 0.55,
  atrStopMultiplier: 1.25,
  minAtrStopPercent: 0.55,
  maxAtrStopPercent: 2.4,
  portfolioReduceSizeFactor: 0.5,
  repeatSymbolExposureThresholdPercent: 18,
  repeatSymbolSizeFactor: 0.72,
} as const;

export type RiskEfficiencyAdjustment = {
  stopLossPercent: number;
  notionalMultiplier: number;
  adjustedNotional: number;
  adjustedQuantity: number;
  factors: Record<string, number>;
  portfolioAction: string;
  portfolioBlocked: boolean;
  portfolioAllocation?: PortfolioAllocationTelemetry;
  stopLossSource: "base" | "atr_blend";
};

export function resolveVolatilityAwareStopLossPercent(input: {
  baseStopLossPercent: number;
  atrPercent: number;
  volatilityPercent: number;
}): { stopLossPercent: number; source: "base" | "atr_blend" } {
  const base = Math.max(env.EXECUTION_DEFAULT_STOP_LOSS_PERCENT * 0.75, input.baseStopLossPercent);
  const atrPercent = Number.isFinite(input.atrPercent) && input.atrPercent > 0 ? input.atrPercent : 0;
  if (atrPercent <= 0) {
    return { stopLossPercent: round(base), source: "base" };
  }
  const atrStop = clamp(
    atrPercent * RISK_EFFICIENCY_POLICY.atrStopMultiplier,
    RISK_EFFICIENCY_POLICY.minAtrStopPercent,
    RISK_EFFICIENCY_POLICY.maxAtrStopPercent,
  );
  // Never tighten below validated base — only widen in elevated volatility to reduce noise stop-outs.
  const blended = Math.max(base, atrStop);
  return { stopLossPercent: round(blended), source: blended > base ? "atr_blend" : "base" };
}

export function resolveAdaptiveNotionalMultiplier(input: {
  confidencePercent: number;
  volatilityPercent: number;
  aiRiskScore: number;
  marketRegimeRiskMultiplier: number;
  consecutiveLosses: number;
  equityDrawdownPercent: number;
  portfolioExposureFactor?: number;
  repeatSymbolExposurePercent?: number;
}): { multiplier: number; factors: Record<string, number> } {
  const eliteSetup = input.confidencePercent >= 82 && input.aiRiskScore <= 50;
  const confidenceFactor = eliteSetup ? 1 : clamp(input.confidencePercent / 68, 0.88, 1.05);
  const volatilityFactor = eliteSetup
    ? 1
    : clamp(RISK_EFFICIENCY_POLICY.volatilityTargetPercent / Math.max(0.35, input.volatilityPercent), 0.78, 1.08);
  const regimeFactor = clamp(input.marketRegimeRiskMultiplier || 1, 0.72, 1.02);
  const aiRiskFactor =
    input.aiRiskScore > 70 && input.confidencePercent < 82
      ? clamp(1 - (input.aiRiskScore - 70) / 90, 0.62, 0.92)
      : 1;
  const streakFactor =
    input.consecutiveLosses >= 2
      ? clamp(
          RISK_EFFICIENCY_POLICY.consecutiveLossDecay ** Math.max(0, input.consecutiveLosses - 1),
          RISK_EFFICIENCY_POLICY.maxConsecutiveLossDecay,
          1,
        )
      : 1;
  const drawdownFactor =
    input.equityDrawdownPercent >= RISK_EFFICIENCY_POLICY.drawdownSoftLimitPercent
      ? clamp(
          1 - (input.equityDrawdownPercent - RISK_EFFICIENCY_POLICY.drawdownSoftLimitPercent) / 24,
          RISK_EFFICIENCY_POLICY.drawdownSoftMultiplierFloor,
          1,
        )
      : 1;
  const portfolioFactor = input.portfolioExposureFactor ?? 1;
  const repeatSymbolFactor =
    (input.repeatSymbolExposurePercent ?? 0) >= RISK_EFFICIENCY_POLICY.repeatSymbolExposureThresholdPercent
      ? RISK_EFFICIENCY_POLICY.repeatSymbolSizeFactor
      : 1;
  const raw =
    confidenceFactor *
    volatilityFactor *
    regimeFactor *
    aiRiskFactor *
    streakFactor *
    drawdownFactor *
    portfolioFactor *
    repeatSymbolFactor;
  const floor = eliteSetup ? 0.92 : RISK_EFFICIENCY_POLICY.minNotionalMultiplier;
  const multiplier = clamp(raw, floor, RISK_EFFICIENCY_POLICY.maxNotionalMultiplier);
  return {
    multiplier: round(multiplier, 4),
    factors: {
      confidenceFactor: round(confidenceFactor, 4),
      volatilityFactor: round(volatilityFactor, 4),
      regimeFactor: round(regimeFactor, 4),
      aiRiskFactor: round(aiRiskFactor, 4),
      streakFactor: round(streakFactor, 4),
      drawdownFactor: round(drawdownFactor, 4),
      portfolioFactor: round(portfolioFactor, 4),
      repeatSymbolFactor: round(repeatSymbolFactor, 4),
      eliteSetup: eliteSetup ? 1 : 0,
    },
  };
}

export function resolveRiskBudgetNeutralScale(input: {
  baseStopLossPercent: number;
  adjustedStopLossPercent: number;
}): number {
  if (input.adjustedStopLossPercent <= 0) return 1;
  return clamp(input.baseStopLossPercent / input.adjustedStopLossPercent, 0.45, 1);
}

export function resolvePortfolioExposureFactor(input: {
  accountEquity: number;
  openPositions: PortfolioPositionInput[];
  symbol: string;
  strategy: string;
  requestedNotional: number;
}): { factor: number; action: string; riskScore: number; blocked: boolean } {
  if (input.accountEquity <= 0 || input.requestedNotional <= 0) {
    return { factor: 1, action: "ALLOW", riskScore: 0, blocked: false };
  }
  const analysis = smartPortfolioManager.analyze({
    accountEquity: input.accountEquity,
    positions: input.openPositions,
    intent: {
      symbol: input.symbol,
      side: "LONG",
      requestedNotional: input.requestedNotional,
      strategy: input.strategy,
    },
  });
  const action = analysis.decision?.action ?? "ALLOW";
  if (action === "BLOCK") {
    return {
      factor: 0,
      action,
      riskScore: analysis.decision?.riskScore ?? 100,
      blocked: true,
    };
  }
  if (action === "REDUCE_SIZE") {
    return {
      factor: RISK_EFFICIENCY_POLICY.portfolioReduceSizeFactor,
      action,
      riskScore: analysis.decision?.riskScore ?? 0,
      blocked: false,
    };
  }
  return { factor: 1, action, riskScore: analysis.decision?.riskScore ?? 0, blocked: false };
}

export function computeSymbolExposurePercent(input: {
  openPositions: PortfolioPositionInput[];
  symbol: string;
  accountEquity: number;
}): number {
  if (input.accountEquity <= 0) return 0;
  const target = input.symbol.toUpperCase();
  const exposure = input.openPositions
    .filter((p) => p.symbol.toUpperCase() === target)
    .reduce((sum, p) => sum + Math.abs(p.quantity * p.currentPrice), 0);
  return round((exposure / input.accountEquity) * 100, 4);
}

export function resolveRiskEfficiencyAdjustment(input: {
  baseStopLossPercent: number;
  atrPercent: number;
  volatilityPercent: number;
  confidencePercent: number;
  aiRiskScore: number;
  marketRegimeRiskMultiplier: number;
  marketRegime: string;
  consecutiveLosses: number;
  equityDrawdownPercent: number;
  notional: number;
  quantity: number;
  accountEquity: number;
  symbol: string;
  strategy: string;
  openPositions: PortfolioPositionInput[];
  expectedProfitPercent?: number;
  rankingScore?: number;
  liquidity24h?: number;
}): RiskEfficiencyAdjustment {
  const stop = resolveVolatilityAwareStopLossPercent({
    baseStopLossPercent: input.baseStopLossPercent,
    atrPercent: input.atrPercent,
    volatilityPercent: input.volatilityPercent,
  });
  const repeatSymbolExposurePercent = computeSymbolExposurePercent({
    openPositions: input.openPositions,
    symbol: input.symbol,
    accountEquity: input.accountEquity,
  });
  const portfolio = resolvePortfolioExposureFactor({
    accountEquity: input.accountEquity,
    openPositions: input.openPositions,
    symbol: input.symbol,
    strategy: input.strategy,
    requestedNotional: input.notional,
  });
  const allocation = resolvePortfolioAllocationPolicy({
    accountEquity: input.accountEquity,
    openPositions: input.openPositions,
    symbol: input.symbol,
    strategy: input.strategy,
    requestedNotional: input.notional,
    confidencePercent: input.confidencePercent,
    expectedProfitPercent: input.expectedProfitPercent ?? 0.35,
    rankingScore: input.rankingScore ?? 60,
    aiRiskScore: input.aiRiskScore,
    marketRegime: input.marketRegime,
    volatilityPercent: input.volatilityPercent,
    liquidity24h: input.liquidity24h,
  });
  const sizing = resolveAdaptiveNotionalMultiplier({
    confidencePercent: input.confidencePercent,
    volatilityPercent: input.volatilityPercent,
    aiRiskScore: input.aiRiskScore,
    marketRegimeRiskMultiplier: input.marketRegimeRiskMultiplier,
    consecutiveLosses: input.consecutiveLosses,
    equityDrawdownPercent: input.equityDrawdownPercent,
    portfolioExposureFactor: 1,
    repeatSymbolExposurePercent,
  });
  const riskBudgetScale = resolveRiskBudgetNeutralScale({
    baseStopLossPercent: input.baseStopLossPercent,
    adjustedStopLossPercent: stop.stopLossPercent,
  });
  const riskAdjusted = resolveRiskAdjustedNotionalMultiplier({
    confidencePercent: input.confidencePercent,
    aiRiskScore: input.aiRiskScore,
    marketRegime: input.marketRegime,
    strategy: input.strategy,
    volatilityPercent: input.volatilityPercent,
  });
  const notionalMultiplier = round(
    sizing.multiplier * riskBudgetScale * riskAdjusted.multiplier * allocation.allocationMultiplier,
    4,
  );
  const adjustedNotional = portfolio.blocked || allocation.portfolioBlocked
    ? 0
    : round(input.notional * notionalMultiplier, 8);
  const adjustedQuantity = portfolio.blocked || allocation.portfolioBlocked
    ? 0
    : round(input.quantity * notionalMultiplier, 8);
  return {
    stopLossPercent: stop.stopLossPercent,
    notionalMultiplier,
    adjustedNotional,
    adjustedQuantity,
    factors: {
      ...sizing.factors,
      riskBudgetScale: round(riskBudgetScale, 4),
      repeatSymbolExposurePercent,
      riskAdjustedMultiplier: riskAdjusted.multiplier,
      allocationMultiplier: allocation.allocationMultiplier,
      correlationFactor: allocation.telemetry.correlationFactor,
      confidenceWeight: allocation.telemetry.confidenceWeight,
      expectedValueWeight: allocation.telemetry.expectedValueWeight,
      ...riskAdjusted.factors,
    },
    portfolioAction: portfolio.blocked ? portfolio.action : allocation.portfolioAction,
    portfolioBlocked: portfolio.blocked || allocation.portfolioBlocked,
    portfolioAllocation: allocation.telemetry,
    stopLossSource: stop.source,
  };
}

export type DrawdownMetrics = {
  maxDrawdown: number;
  averageDrawdown: number;
  recoveryFactor: number;
  capitalEfficiency: number;
  totalPnl: number;
  peakEquity: number;
};

export function computeDrawdownMetrics(pnls: number[], initialEquity = 1000): DrawdownMetrics {
  let equity = initialEquity;
  let peak = initialEquity;
  let maxDrawdown = 0;
  const drawdowns: number[] = [];
  for (const pnl of pnls) {
    equity += pnl;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    if (dd > 0) drawdowns.push(dd);
    maxDrawdown = Math.max(maxDrawdown, dd);
  }
  const totalPnl = pnls.reduce((a, b) => a + b, 0);
  const averageDrawdown = drawdowns.length ? drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length : 0;
  const recoveryFactor = maxDrawdown > 0 ? round(totalPnl / maxDrawdown, 4) : totalPnl > 0 ? 999 : 0;
  const capitalEfficiency = initialEquity > 0 ? round(totalPnl / initialEquity, 4) : 0;
  return {
    maxDrawdown: round(maxDrawdown, 4),
    averageDrawdown: round(averageDrawdown, 4),
    recoveryFactor,
    capitalEfficiency,
    totalPnl: round(totalPnl, 4),
    peakEquity: round(peak, 4),
  };
}
