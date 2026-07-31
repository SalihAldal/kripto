import { tradingConfig } from "@/src/server/trading-core/config";

export type RiskEngineConfig = {
  maxDailyLossPercent: number;
  maxOpenPositions: number;
  maxRiskScore: number;
  highRiskScore: number;
  midRiskScore: number;
  baseRiskPerTradePercent: number;
  highRiskSizeMultiplier: number;
  midRiskSizeMultiplier: number;
  lowRiskSizeMultiplier: number;
  cooldownMsAfterDeny: number;
  maxConsecutiveLosses: number;
  minWinratePercent: number;
  minLiquidationDistancePercent: number;
  maxCorrelationGroupPositions: number;
};

export function getRiskEngineConfig(): RiskEngineConfig {
  return {
    maxDailyLossPercent: tradingConfig.getGlobal("maxDailyLossPercent"),
    maxOpenPositions: tradingConfig.getGlobal("maxOpenPositions"),
    maxRiskScore: 78,
    highRiskScore: 65,
    midRiskScore: 38,
    baseRiskPerTradePercent: 1,
    highRiskSizeMultiplier: 0.25,
    midRiskSizeMultiplier: 0.5,
    lowRiskSizeMultiplier: 1,
    cooldownMsAfterDeny: tradingConfig.getGlobal("cooldownMsAfterDeny"),
    maxConsecutiveLosses: 3,
    minWinratePercent: 42,
    minLiquidationDistancePercent: tradingConfig.getGlobal("minLiquidationDistancePercent"),
    maxCorrelationGroupPositions: 1,
  };
}

export const defaultRiskEngineConfig: RiskEngineConfig = getRiskEngineConfig();
