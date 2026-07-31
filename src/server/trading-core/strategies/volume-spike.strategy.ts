import { tradingConfig } from "@/src/server/trading-core/config";
import { buildIndicatorSnapshot } from "@/src/server/trading-core/indicators";
import { clamp } from "@/src/server/trading-core/indicators/math";
import type { MarketSnapshot, StrategySignal, TradeSide } from "@/src/server/trading-core/core/types";
import type { SignalStrategy } from "@/src/server/trading-core/strategies/strategy";

export class VolumeSpikeStrategy implements SignalStrategy {
  readonly name = "volume-spike";

  constructor(public readonly enabled = true) {}

  async evaluate(snapshot: MarketSnapshot): Promise<StrategySignal> {
    const indicators = buildIndicatorSnapshot(snapshot.candles);
    const latest = snapshot.candles[snapshot.candles.length - 1];
    const previous = snapshot.candles[snapshot.candles.length - 2];
    const priceUp = latest && previous ? latest.close > previous.close : false;
    const spike = indicators.volumeSpike;
    let side: TradeSide = "HOLD";
    let score = 45;
    const reasons: string[] = [];

    if (spike?.isSpike) {
      score += Math.min(30, spike.ratio * 8);
      side = priceUp ? "BUY" : "SELL";
      reasons.push(`Volume spike ratio: ${spike.ratio}`);
      reasons.push(priceUp ? "Spike confirms upward candle" : "Spike confirms downward candle");
    }

    const finalScore = clamp(score, 0, 100);
    return {
      strategy: this.name,
      symbol: snapshot.symbol,
      side: finalScore >= tradingConfig.getStrategy(this.name).minScore ? side : "HOLD",
      score: finalScore,
      confidence: clamp(finalScore - 12, 0, 100),
      reasons: reasons.length ? reasons : ["No actionable volume spike"],
      indicators,
      generatedAt: new Date().toISOString(),
    };
  }
}
