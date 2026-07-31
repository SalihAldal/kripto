import { clamp } from "@/src/server/trading-core/indicators/math";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import type { TradeQualityDecision, TradeQualityFilterResult, TradeQualityInput, TradeQualityLevel } from "@/src/server/trading-core/trade-quality/trade-quality-types";

function riskReward(input: TradeQualityInput) {
  if (!input.entryPrice || !input.takeProfitPrice || !input.stopLossPrice || input.entryPrice <= 0) return 0;
  const reward = Math.abs(input.takeProfitPrice - input.entryPrice);
  const risk = Math.abs(input.entryPrice - input.stopLossPrice);
  return risk > 0 ? reward / risk : 0;
}

function level(score: number): TradeQualityLevel {
  if (score >= 82) return "A";
  if (score >= 68) return "B";
  if (score >= 52) return "C";
  if (score >= 35) return "D";
  return "F";
}

export class TradeQualityEngine {
  evaluate(input: TradeQualityInput): TradeQualityDecision {
    const rr = riskReward(input);
    const filters = this.filters(input, rr);
    const penalty = filters.filter((filter) => !filter.passed).reduce((sum, filter) => sum + (filter.severity === "HIGH" ? 18 : filter.severity === "MEDIUM" ? 10 : 5), 0);
    const signalBoost = input.signalFusion ? input.signalFusion.confidence * 0.2 + input.signalFusion.score * 0.1 : 12;
    const baseQuality = 72 + signalBoost - penalty;
    const probabilityScore = clamp(
      baseQuality +
        (input.marketRegime?.tradeAllowed === false ? -25 : 0) +
        Math.min(input.volumeRatio ?? 1, 3) * 3 +
        Math.min(rr, 4) * 4 -
        (input.liquidationHeatmap?.manipulationRiskScore ?? 0) * 0.18,
      0,
      100,
    );
    const qualityScore = Number(clamp(baseQuality, 0, 100).toFixed(2));
    const blockedReasons = filters.filter((filter) => !filter.passed && filter.severity === "HIGH").map((filter) => filter.reason);
    const minQualityScore = input.minQualityScore ?? 62;
    const action = blockedReasons.length > 0 || probabilityScore < 45 ? "BLOCK" : probabilityScore < minQualityScore || qualityScore < minQualityScore ? "REDUCE_SIZE" : "ALLOW";
    const decision: TradeQualityDecision = {
      symbol: input.symbol.toUpperCase(),
      side: input.side,
      action,
      allowed: action !== "BLOCK",
      qualityLevel: level(qualityScore),
      qualityScore,
      probabilityScore: Number(probabilityScore.toFixed(2)),
      riskRewardRatio: Number(rr.toFixed(4)),
      filters,
      blockedReasons: blockedReasons.length > 0 ? blockedReasons : action === "BLOCK" ? ["Trade probability below minimum threshold"] : [],
      sizeMultiplier: action === "ALLOW" ? 1 : action === "REDUCE_SIZE" ? 0.45 : 0,
      generatedAt: new Date().toISOString(),
    };
    tradingLogger.info({
      category: "RISK",
      source: "trading-core.trade-quality",
      message: `Trade quality ${decision.symbol}: ${decision.action}`,
      status: decision.allowed ? "SUCCESS" : "FAILED",
      symbol: decision.symbol,
      metricName: "trade_quality.probability",
      metricValue: decision.probabilityScore,
      context: { qualityScore: decision.qualityScore, blockedReasons: decision.blockedReasons },
    });
    return decision;
  }

  private filters(input: TradeQualityInput, rr: number): TradeQualityFilterResult[] {
    const volumeRatio = input.volumeRatio ?? input.marketRegime?.metrics.volumeRatio ?? 1;
    const breakoutStrength = input.breakoutStrength ?? input.marketRegime?.metrics.trendStrength ?? 0;
    const spread = input.spreadPercent ?? 0.15;
    const liquidity = input.liquidityUsd ?? input.orderbookDepthUsd ?? 100_000;
    const funding = Math.abs(input.fundingRatePercent ?? 0);
    const newsSpike = input.newsSpikeScore ?? (input.marketRegime && input.marketRegime.metrics.volumeRatio >= 3.2 && input.marketRegime.metrics.volatilityPercent >= 2.2 ? 75 : 0);
    const manipulation = input.liquidationHeatmap?.manipulationRiskScore ?? (input.marketRegime?.regime === "MANIPULATION_ZONE" ? 85 : 0);
    const breakoutRequired = input.marketRegime?.strategyMode === "BREAKOUT" || input.marketRegime?.regime === "HIGH_VOLATILITY";

    return [
      this.filter("LOW_VOLUME", volumeRatio >= 0.65, volumeRatio * 40, volumeRatio < 0.35 ? "HIGH" : "MEDIUM", `Volume ratio too low: ${volumeRatio.toFixed(2)}`),
      this.filter("WEAK_BREAKOUT", !breakoutRequired || breakoutStrength >= 24, breakoutStrength, breakoutStrength < 14 ? "MEDIUM" : "LOW", `Breakout strength weak: ${breakoutStrength.toFixed(2)}`),
      this.filter("BAD_RISK_REWARD", rr === 0 || rr >= 1.25, rr * 35, rr > 0 && rr < 0.9 ? "HIGH" : "MEDIUM", `Risk/reward is poor: ${rr.toFixed(2)}`),
      this.filter("FUNDING_EXTREME", funding <= 0.12, 100 - funding * 600, funding > 0.18 ? "HIGH" : "MEDIUM", `Funding is extreme: ${funding.toFixed(4)}%`),
      this.filter("NEWS_SPIKE", newsSpike < 78, 100 - newsSpike, newsSpike >= 90 ? "HIGH" : "MEDIUM", `News spike risk high: ${newsSpike.toFixed(2)}`),
      this.filter("MANIPULATION_RISK", manipulation < 68, 100 - manipulation, manipulation >= 82 ? "HIGH" : "MEDIUM", `Manipulation risk high: ${manipulation.toFixed(2)}`),
      this.filter("WIDE_SPREAD", spread <= 0.45, 100 - spread * 120, spread > 0.8 ? "HIGH" : "MEDIUM", `Spread too wide: ${spread.toFixed(4)}%`),
      this.filter("LOW_LIQUIDITY", liquidity >= 25_000, Math.min(100, liquidity / 1_000), liquidity < 10_000 ? "HIGH" : "MEDIUM", `Liquidity too low: ${liquidity.toFixed(2)} USD`),
    ];
  }

  private filter(type: TradeQualityFilterResult["type"], passed: boolean, score: number, severity: TradeQualityFilterResult["severity"], reason: string): TradeQualityFilterResult {
    return {
      type,
      passed,
      score: Number(clamp(score, 0, 100).toFixed(2)),
      severity,
      reason: passed ? `${type} passed` : reason,
    };
  }
}

const globalQuality = globalThis as typeof globalThis & { __tradeQualityEngine?: TradeQualityEngine };
export const tradeQualityEngine = globalQuality.__tradeQualityEngine ?? new TradeQualityEngine();
globalQuality.__tradeQualityEngine = tradeQualityEngine;
