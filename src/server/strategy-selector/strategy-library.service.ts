import type { AdaptiveRegimeLabel, CoinClassificationType, StrategySelectorType } from "@prisma/client";
import type { RegimeDetectionResult } from "@/src/server/strategy-selector/strategy-selector.types";

export const STRATEGY_PROFILES: Array<{
  strategyType: StrategySelectorType;
  displayName: string;
  description: string;
  confidenceThreshold: number;
  momentumThreshold: number;
  volumeThreshold: number;
  liquidityThreshold: number;
  riskThreshold: number;
  expectedWinRate: number;
  expectedProfitFactor: number;
  historicalAccuracy: number;
  compatibleRegimes: AdaptiveRegimeLabel[];
  compatibleCoins: CoinClassificationType[];
}> = [
  { strategyType: "MOMENTUM", displayName: "Momentum Strategy", description: "Ride strong directional moves on Binance Spot", confidenceThreshold: 65, momentumThreshold: 70, volumeThreshold: 60, liquidityThreshold: 55, riskThreshold: 60, expectedWinRate: 58, expectedProfitFactor: 1.8, historicalAccuracy: 55, compatibleRegimes: ["STRONG_BULL", "WEAK_BULL", "FLASH_PUMP", "BREAKOUT"], compatibleCoins: ["LARGE_CAP", "MID_CAP", "LAYER1"] },
  { strategyType: "BREAKOUT", displayName: "Breakout Strategy", description: "Enter on confirmed range breakouts", confidenceThreshold: 68, momentumThreshold: 65, volumeThreshold: 75, liquidityThreshold: 60, riskThreshold: 55, expectedWinRate: 52, expectedProfitFactor: 2.1, historicalAccuracy: 50, compatibleRegimes: ["BREAKOUT", "ACCUMULATION", "STRONG_BULL"], compatibleCoins: ["MID_CAP", "LOW_CAP", "DEFI"] },
  { strategyType: "TREND_FOLLOWING", displayName: "Trend Following", description: "Follow established spot trends", confidenceThreshold: 62, momentumThreshold: 60, volumeThreshold: 55, liquidityThreshold: 50, riskThreshold: 50, expectedWinRate: 60, expectedProfitFactor: 1.6, historicalAccuracy: 58, compatibleRegimes: ["STRONG_BULL", "WEAK_BULL", "STRONG_BEAR", "WEAK_BEAR"], compatibleCoins: ["LARGE_CAP", "LAYER1", "LAYER2"] },
  { strategyType: "PULLBACK", displayName: "Pullback Strategy", description: "Buy dips in uptrends", confidenceThreshold: 64, momentumThreshold: 55, volumeThreshold: 50, liquidityThreshold: 55, riskThreshold: 45, expectedWinRate: 62, expectedProfitFactor: 1.7, historicalAccuracy: 60, compatibleRegimes: ["STRONG_BULL", "WEAK_BULL", "ACCUMULATION"], compatibleCoins: ["LARGE_CAP", "MID_CAP"] },
  { strategyType: "MEAN_REVERSION", displayName: "Mean Reversion", description: "Fade overextensions in range", confidenceThreshold: 60, momentumThreshold: 40, volumeThreshold: 45, liquidityThreshold: 50, riskThreshold: 40, expectedWinRate: 55, expectedProfitFactor: 1.4, historicalAccuracy: 52, compatibleRegimes: ["RANGE", "LOW_VOLATILITY"], compatibleCoins: ["LARGE_CAP", "STABLECOIN"] },
  { strategyType: "RANGE_TRADING", displayName: "Range Trading", description: "Trade defined support/resistance bands", confidenceThreshold: 58, momentumThreshold: 35, volumeThreshold: 40, liquidityThreshold: 55, riskThreshold: 35, expectedWinRate: 57, expectedProfitFactor: 1.3, historicalAccuracy: 54, compatibleRegimes: ["RANGE", "LOW_VOLATILITY", "ACCUMULATION"], compatibleCoins: ["LARGE_CAP", "MID_CAP"] },
  { strategyType: "NEWS", displayName: "News Strategy", description: "Capitalize on news-driven spot rallies", confidenceThreshold: 70, momentumThreshold: 60, volumeThreshold: 80, liquidityThreshold: 50, riskThreshold: 65, expectedWinRate: 48, expectedProfitFactor: 2.5, historicalAccuracy: 45, compatibleRegimes: ["NEWS_RALLY", "FLASH_PUMP"], compatibleCoins: ["AI_COIN", "LAYER1", "DEFI"] },
  { strategyType: "WHALE", displayName: "Whale Strategy", description: "Follow large wallet accumulation", confidenceThreshold: 68, momentumThreshold: 55, volumeThreshold: 70, liquidityThreshold: 60, riskThreshold: 55, expectedWinRate: 50, expectedProfitFactor: 2.0, historicalAccuracy: 48, compatibleRegimes: ["WHALE_DRIVEN", "ACCUMULATION"], compatibleCoins: ["LARGE_CAP", "MID_CAP"] },
  { strategyType: "LISTING", displayName: "Listing Strategy", description: "New Binance Spot listing momentum", confidenceThreshold: 72, momentumThreshold: 75, volumeThreshold: 85, liquidityThreshold: 40, riskThreshold: 75, expectedWinRate: 40, expectedProfitFactor: 3.0, historicalAccuracy: 38, compatibleRegimes: ["FLASH_PUMP", "BREAKOUT"], compatibleCoins: ["NEW_LISTING", "MICRO_CAP"] },
  { strategyType: "LOW_CAP", displayName: "Low Cap Strategy", description: "High-risk micro cap spot moves", confidenceThreshold: 75, momentumThreshold: 70, volumeThreshold: 65, liquidityThreshold: 35, riskThreshold: 80, expectedWinRate: 38, expectedProfitFactor: 2.8, historicalAccuracy: 35, compatibleRegimes: ["FLASH_PUMP", "HIGH_VOLATILITY"], compatibleCoins: ["LOW_CAP", "MICRO_CAP", "MEME_COIN"] },
  { strategyType: "SCALP", displayName: "Scalp Strategy", description: "Quick spot scalps on high liquidity pairs", confidenceThreshold: 55, momentumThreshold: 50, volumeThreshold: 70, liquidityThreshold: 75, riskThreshold: 30, expectedWinRate: 65, expectedProfitFactor: 1.2, historicalAccuracy: 62, compatibleRegimes: ["RANGE", "LOW_VOLATILITY", "HIGH_VOLATILITY"], compatibleCoins: ["LARGE_CAP"] },
  { strategyType: "SWING", displayName: "Swing Strategy", description: "Multi-day spot swing trades", confidenceThreshold: 60, momentumThreshold: 55, volumeThreshold: 45, liquidityThreshold: 50, riskThreshold: 45, expectedWinRate: 58, expectedProfitFactor: 1.9, historicalAccuracy: 56, compatibleRegimes: ["STRONG_BULL", "WEAK_BULL", "ACCUMULATION"], compatibleCoins: ["LARGE_CAP", "MID_CAP", "LAYER1"] },
  { strategyType: "HIGH_VOLATILITY", displayName: "High Volatility Strategy", description: "Exploit elevated spot volatility", confidenceThreshold: 70, momentumThreshold: 65, volumeThreshold: 60, liquidityThreshold: 45, riskThreshold: 70, expectedWinRate: 45, expectedProfitFactor: 2.2, historicalAccuracy: 42, compatibleRegimes: ["HIGH_VOLATILITY", "FLASH_PUMP", "FLASH_DUMP"], compatibleCoins: ["MEME_COIN", "LOW_CAP"] },
  { strategyType: "CONSERVATIVE", displayName: "Conservative Strategy", description: "Capital preservation — high-quality entries only", confidenceThreshold: 75, momentumThreshold: 50, volumeThreshold: 55, liquidityThreshold: 70, riskThreshold: 25, expectedWinRate: 68, expectedProfitFactor: 1.4, historicalAccuracy: 65, compatibleRegimes: ["LOW_VOLATILITY", "RANGE", "WEAK_BULL"], compatibleCoins: ["LARGE_CAP", "STABLECOIN"] },
  { strategyType: "AGGRESSIVE", displayName: "Aggressive Strategy", description: "Maximize capture of strong momentum", confidenceThreshold: 55, momentumThreshold: 75, volumeThreshold: 65, liquidityThreshold: 40, riskThreshold: 85, expectedWinRate: 42, expectedProfitFactor: 2.5, historicalAccuracy: 40, compatibleRegimes: ["STRONG_BULL", "FLASH_PUMP", "BREAKOUT"], compatibleCoins: ["MEME_COIN", "LOW_CAP", "AI_COIN"] },
];

export function getStrategyProfile(type: StrategySelectorType) {
  return STRATEGY_PROFILES.find((p) => p.strategyType === type);
}

export function getAllStrategyProfiles() {
  return STRATEGY_PROFILES;
}

export function getThresholdProfile(type: StrategySelectorType) {
  const p = getStrategyProfile(type);
  if (!p) return null;
  return {
    confidenceThreshold: p.confidenceThreshold,
    momentumThreshold: p.momentumThreshold,
    volumeThreshold: p.volumeThreshold,
    liquidityThreshold: p.liquidityThreshold,
    riskThreshold: p.riskThreshold,
  };
}

export function isRegimeCompatible(strategy: StrategySelectorType, regime: RegimeDetectionResult | AdaptiveRegimeLabel) {
  const label = typeof regime === "string" ? regime : regime.regimeLabel;
  const profile = getStrategyProfile(strategy);
  return profile?.compatibleRegimes.includes(label) ?? false;
}

export function isCoinCompatible(strategy: StrategySelectorType, coin: CoinClassificationType) {
  const profile = getStrategyProfile(strategy);
  return profile?.compatibleCoins.includes(coin) ?? false;
}
