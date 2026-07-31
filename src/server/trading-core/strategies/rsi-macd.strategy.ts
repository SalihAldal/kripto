import { tradingConfig } from "@/src/server/trading-core/config";
import { buildIndicatorSnapshot } from "@/src/server/trading-core/indicators";
import { clamp } from "@/src/server/trading-core/indicators/math";
import type { MarketSnapshot, StrategySignal, TradeSide } from "@/src/server/trading-core/core/types";
import type { SignalStrategy } from "@/src/server/trading-core/strategies/strategy";

export class RsiMacdStrategy implements SignalStrategy {
  readonly name = "rsi-macd";

  constructor(public readonly enabled = true) {}

  async evaluate(snapshot: MarketSnapshot): Promise<StrategySignal> {
    const indicators = buildIndicatorSnapshot(snapshot.candles);
    const reasons: string[] = [];
    let side: TradeSide = "HOLD";
    let score = 50;

    if (indicators.rsi !== undefined && indicators.rsi < 32) {
      score += 18;
      side = "BUY";
      reasons.push(`RSI oversold: ${indicators.rsi}`);
    } else if (indicators.rsi !== undefined && indicators.rsi > 68) {
      score += 18;
      side = "SELL";
      reasons.push(`RSI overbought: ${indicators.rsi}`);
    }

    if (indicators.macd && indicators.macd.histogram > 0) {
      score += side === "SELL" ? -10 : 14;
      if (side === "HOLD") side = "BUY";
      reasons.push("MACD bullish histogram");
    } else if (indicators.macd && indicators.macd.histogram < 0) {
      score += side === "BUY" ? -10 : 14;
      if (side === "HOLD") side = "SELL";
      reasons.push("MACD bearish histogram");
    }

    if (indicators.emaFast && indicators.emaSlow) {
      const bullish = indicators.emaFast > indicators.emaSlow;
      if ((bullish && side === "BUY") || (!bullish && side === "SELL")) score += 10;
      reasons.push(bullish ? "EMA fast above EMA slow" : "EMA fast below EMA slow");
    }

    const finalScore = clamp(score, 0, 100);
    return {
      strategy: this.name,
      symbol: snapshot.symbol,
      side: finalScore >= tradingConfig.getStrategy(this.name).minScore ? side : "HOLD",
      score: finalScore,
      confidence: clamp(finalScore - 10, 0, 100),
      reasons: reasons.length ? reasons : ["No decisive RSI/MACD edge"],
      indicators,
      generatedAt: new Date().toISOString(),
    };
  }
}
