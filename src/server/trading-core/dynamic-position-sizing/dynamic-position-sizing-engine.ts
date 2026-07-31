import { clamp } from "@/src/server/trading-core/indicators/math";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import { getDynamicPositionSizingConfig } from "@/src/server/trading-core/dynamic-position-sizing/dynamic-position-sizing-config";
import type {
  DynamicPositionSizingConfig,
  DynamicPositionSizingDecision,
  DynamicPositionSizingInput,
  PositionSizingFactor,
  PositionSizingRiskLevel,
} from "@/src/server/trading-core/dynamic-position-sizing/dynamic-position-sizing-types";

function round(value: number, decimals = 4) {
  return Number(value.toFixed(decimals));
}

export class DynamicPositionSizingEngine {
  calculate(input: DynamicPositionSizingInput): DynamicPositionSizingDecision {
    const config: DynamicPositionSizingConfig = { ...getDynamicPositionSizingConfig(), ...(input.config ?? {}) };
    const leverage = Math.max(1, input.leverage ?? 1);
    const requestedNotional = input.requestedNotional ?? input.accountEquity * (config.maxEquityPercent / 100);
    const baseNotional = input.accountEquity * (config.baseRiskPercent / 100);
    const liquidationDistance = input.liquidationDistancePercent ?? this.heatmapLiquidationDistance(input);
    const factors = this.factors(input, config, leverage, liquidationDistance);
    const multiplier = factors.reduce((value, factor) => value * factor.multiplier, 1);
    const hardBlocked = input.drawdownPercent >= config.drawdownHardLimitPercent || liquidationDistance < config.minLiquidationDistancePercent;
    const capByEquity = input.accountEquity * (config.maxEquityPercent / 100);
    const adjusted = hardBlocked ? 0 : clamp(baseNotional * multiplier, config.minNotionalUsd, Math.min(requestedNotional, config.maxNotionalUsd, capByEquity));
    const riskLevel = this.riskLevel(input, liquidationDistance, factors, hardBlocked);
    const decision: DynamicPositionSizingDecision = {
      symbol: input.symbol.toUpperCase(),
      side: input.side,
      allowed: !hardBlocked && adjusted > 0,
      riskLevel,
      baseNotional: round(baseNotional, 2),
      requestedNotional: round(requestedNotional, 2),
      adjustedNotional: round(adjusted, 2),
      positionSizePercent: round(input.accountEquity > 0 ? adjusted / input.accountEquity * 100 : 0, 4),
      leverage,
      factors,
      reasons: [
        hardBlocked ? "Position blocked by drawdown/liquidation hard limit" : "Position size calculated dynamically",
        `confidence=${input.confidenceScore}`,
        `volatility=${input.volatilityPercent}%`,
        `drawdown=${input.drawdownPercent}%`,
        `liquidationDistance=${liquidationDistance}%`,
      ],
      generatedAt: new Date().toISOString(),
    };
    tradingLogger.info({
      category: "RISK",
      source: "trading-core.dynamic-position-sizing",
      message: `Dynamic position size ${decision.symbol}: ${decision.adjustedNotional}`,
      status: decision.allowed ? "SUCCESS" : "FAILED",
      symbol: decision.symbol,
      metricName: "position_sizing.adjusted_notional",
      metricValue: decision.adjustedNotional,
      context: { riskLevel, positionSizePercent: decision.positionSizePercent, factors },
    });
    return decision;
  }

  private factors(input: DynamicPositionSizingInput, config: DynamicPositionSizingConfig, leverage: number, liquidationDistance: number): PositionSizingFactor[] {
    const successRate = input.strategySuccessRate ?? input.botMetrics?.winrate ?? 50;
    const regime = input.marketRegime?.regime;
    const heatmapRisk = input.liquidationHeatmap?.manipulationRiskScore ?? 0;
    return [
      {
        name: "CONFIDENCE",
        multiplier: round(clamp(input.confidenceScore / 65, config.lowConfidencePenalty, config.highConfidenceBoost), 4),
        score: input.confidenceScore,
        reason: "Higher confidence increases lot size",
      },
      {
        name: "VOLATILITY",
        multiplier: round(clamp(config.volatilityTargetPercent / Math.max(0.2, input.volatilityPercent), 0.35, 1.25), 4),
        score: round(100 - Math.min(100, input.volatilityPercent * 12), 2),
        reason: "Higher volatility reduces notional",
      },
      {
        name: "DRAWDOWN",
        multiplier: round(clamp(1 - input.drawdownPercent / config.drawdownHardLimitPercent, 0.1, 1), 4),
        score: round(100 - input.drawdownPercent * 5, 2),
        reason: "Current drawdown reduces risk budget",
      },
      {
        name: "STRATEGY_SUCCESS",
        multiplier: round(clamp(successRate / 55, 0.55, 1.35), 4),
        score: successRate,
        reason: "Strategy winrate adjusts lot size",
      },
      {
        name: "MARKET_REGIME",
        multiplier: round(this.regimeMultiplier(regime, input.marketRegime?.tradeAllowed), 4),
        score: input.marketRegime?.confidence ?? 50,
        reason: `Market regime=${regime ?? "UNKNOWN"}`,
      },
      {
        name: "LIQUIDATION_RISK",
        multiplier: round(clamp(liquidationDistance / 18, 0.15, 1.2) * clamp(1 - heatmapRisk / 180, 0.35, 1), 4),
        score: round(Math.min(100, liquidationDistance * 5) - heatmapRisk * 0.25, 2),
        reason: "Closer liquidation/manipulation risk reduces size",
      },
      {
        name: "LEVERAGE",
        multiplier: round(clamp(1 / Math.sqrt(leverage), 0.25, 1), 4),
        score: round(100 / leverage, 2),
        reason: "Higher leverage reduces raw notional budget",
      },
    ];
  }

  private regimeMultiplier(regime?: string, tradeAllowed = true) {
    if (!tradeAllowed || regime === "MANIPULATION_ZONE") return 0.1;
    if (regime === "HIGH_VOLATILITY") return 0.65;
    if (regime === "LOW_VOLATILITY") return 0.55;
    if (regime === "SIDEWAYS") return 0.9;
    if (regime === "TRENDING_BULLISH" || regime === "TRENDING_BEARISH") return 1.12;
    return 0.85;
  }

  private heatmapLiquidationDistance(input: DynamicPositionSizingInput) {
    const closest = input.liquidationHeatmap?.clusters
      .map((cluster) => cluster.distancePercent)
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0];
    return closest ?? 100;
  }

  private riskLevel(input: DynamicPositionSizingInput, liquidationDistance: number, factors: PositionSizingFactor[], hardBlocked: boolean): PositionSizingRiskLevel {
    if (hardBlocked) return "BLOCKED";
    const avgMultiplier = factors.reduce((sum, factor) => sum + factor.multiplier, 0) / Math.max(1, factors.length);
    if (input.drawdownPercent >= 10 || liquidationDistance < 8 || avgMultiplier < 0.45) return "HIGH";
    if (input.volatilityPercent >= 4 || avgMultiplier < 0.75) return "MEDIUM";
    return "LOW";
  }
}

const globalSizer = globalThis as typeof globalThis & { __dynamicPositionSizingEngine?: DynamicPositionSizingEngine };
export const dynamicPositionSizingEngine = globalSizer.__dynamicPositionSizingEngine ?? new DynamicPositionSizingEngine();
globalSizer.__dynamicPositionSizingEngine = dynamicPositionSizingEngine;
