import { clamp } from "@/src/server/trading-core/indicators/math";
import type { RiskScoreBreakdown, RiskTradeInput } from "@/src/server/trading-core/risk-engine/risk-types";

function scoreHigherIsRisk(value: number, dangerAt: number) {
  if (dangerAt <= 0) return 0;
  return clamp((value / dangerAt) * 100, 0, 100);
}

function scoreLowerIsRisk(value: number, safeAt: number) {
  if (safeAt <= 0) return 100;
  return clamp((1 - value / safeAt) * 100, 0, 100);
}

export class RiskScorer {
  calculate(input: RiskTradeInput): { score: number; breakdown: RiskScoreBreakdown } {
    const breakdown: RiskScoreBreakdown = {
      volatility: scoreHigherIsRisk(input.volatilityPercent, 8),
      leverage: scoreHigherIsRisk(Math.max(1, input.leverage) - 1, 20),
      spread: scoreHigherIsRisk(input.spreadPercent, 0.8),
      drawdown: scoreHigherIsRisk(input.drawdownPercent, 12),
      openPositions: scoreHigherIsRisk(input.openPositions, 6),
      winrate: scoreLowerIsRisk(input.winratePercent, 58),
      consecutiveLosses: scoreHigherIsRisk(input.consecutiveLosses, 5),
      fundingRate: scoreHigherIsRisk(Math.abs(input.fundingRatePercent), 0.12),
      liquidationRisk: scoreLowerIsRisk(input.liquidationDistancePercent, 20),
      correlation: scoreHigherIsRisk(input.correlatedSymbols?.length ?? 0, 3),
    };

    const score =
      breakdown.volatility * 0.14 +
      breakdown.leverage * 0.12 +
      breakdown.spread * 0.1 +
      breakdown.drawdown * 0.12 +
      breakdown.openPositions * 0.08 +
      breakdown.winrate * 0.1 +
      breakdown.consecutiveLosses * 0.12 +
      breakdown.fundingRate * 0.07 +
      breakdown.liquidationRisk * 0.1 +
      breakdown.correlation * 0.05;

    return { score: Number(clamp(score, 0, 100).toFixed(2)), breakdown };
  }
}
