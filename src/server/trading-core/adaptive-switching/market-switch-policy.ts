import type { BotConfig } from "@/src/server/trading-core/bots/bot-types";
import type { MarketRegimeDecision } from "@/src/server/trading-core/market-regime";
import type { AdaptiveMarketType } from "@/src/server/trading-core/adaptive-switching/adaptive-switching-types";

export function resolveAdaptiveMarketType(regime: MarketRegimeDecision): AdaptiveMarketType {
  if (regime.regime === "MANIPULATION_ZONE") return "MANIPULATION";
  if (regime.metrics.volumeRatio >= 3.2 && regime.metrics.volatilityPercent >= 2.2) return "NEWS_DRIVEN";
  if (regime.regime === "HIGH_VOLATILITY") return "HIGH_VOLATILITY";
  if (regime.regime === "LOW_VOLATILITY") return "LOW_VOLATILITY";
  if (regime.regime === "SIDEWAYS") return "CHOP";
  return "TREND";
}

export function botAllowedForMarket(bot: BotConfig, marketType: AdaptiveMarketType) {
  const strategy = bot.strategy.toLowerCase();
  if (marketType === "TREND") return bot.id.includes("trend") || bot.preferredModes.includes("TREND");
  if (marketType === "CHOP") return bot.id.includes("scalping") || bot.preferredModes.includes("SCALPING") || strategy.includes("rsi");
  if (marketType === "HIGH_VOLATILITY") return bot.id.includes("breakout") || bot.preferredModes.includes("BREAKOUT");
  if (marketType === "LOW_VOLATILITY") return bot.id.includes("scalping") && bot.maxOpenPositions <= 2;
  if (marketType === "NEWS_DRIVEN") return bot.id.includes("breakout") || bot.preferredModes.includes("BREAKOUT");
  return false;
}

export function confidenceForMarket(regime: MarketRegimeDecision, marketType: AdaptiveMarketType) {
  const metricBoost =
    marketType === "NEWS_DRIVEN"
      ? Math.min(18, regime.metrics.volumeRatio * 4 + regime.metrics.volatilityPercent * 2)
      : marketType === "MANIPULATION"
        ? Math.min(20, regime.metrics.wickAnomalyScore * 5)
        : marketType === "TREND"
          ? Math.min(16, regime.metrics.trendStrength * 0.22)
          : 0;
  return Number(Math.min(100, Math.max(0, regime.confidence + metricBoost)).toFixed(2));
}
