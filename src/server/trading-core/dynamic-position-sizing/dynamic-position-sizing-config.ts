import type { DynamicPositionSizingConfig } from "@/src/server/trading-core/dynamic-position-sizing/dynamic-position-sizing-types";

function readNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function getDynamicPositionSizingConfig(): DynamicPositionSizingConfig {
  return {
    baseRiskPercent: readNumber("TRADING_SIZING_BASE_RISK_PERCENT", 1.2),
    minNotionalUsd: readNumber("TRADING_SIZING_MIN_NOTIONAL_USD", 10),
    maxNotionalUsd: readNumber("TRADING_SIZING_MAX_NOTIONAL_USD", 2_500),
    maxEquityPercent: readNumber("TRADING_SIZING_MAX_EQUITY_PERCENT", 8),
    highConfidenceBoost: readNumber("TRADING_SIZING_HIGH_CONFIDENCE_BOOST", 1.45),
    lowConfidencePenalty: readNumber("TRADING_SIZING_LOW_CONFIDENCE_PENALTY", 0.45),
    volatilityTargetPercent: readNumber("TRADING_SIZING_VOLATILITY_TARGET_PERCENT", 2.5),
    drawdownHardLimitPercent: readNumber("TRADING_SIZING_DRAWDOWN_HARD_LIMIT_PERCENT", 15),
    minLiquidationDistancePercent: readNumber("TRADING_SIZING_MIN_LIQUIDATION_DISTANCE_PERCENT", 5),
  };
}
