import type { MarketCandle, MarketSnapshot } from "@/src/server/trading-core/core/types";
import { calculateEma } from "@/src/server/trading-core/indicators/ema";
import { average, clamp } from "@/src/server/trading-core/indicators/math";
import type { MarketRegimeDecision, MarketRegimeType, StrategyMode, TrendDirection } from "@/src/server/trading-core/market-regime/market-regime.types";

function percent(value: number, base: number) {
  if (!Number.isFinite(base) || base <= 0) return 0;
  return (value / base) * 100;
}

function candleRangePercent(candle: MarketCandle) {
  return percent(candle.high - candle.low, candle.close);
}

function wickAnomaly(candle: MarketCandle) {
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const wick = upperWick + lowerWick;
  return body > 0 ? wick / body : wick > 0 ? 5 : 0;
}

export class MarketRegimeDetector {
  detect(snapshot: MarketSnapshot): MarketRegimeDecision {
    const candles = snapshot.candles.slice(-80);
    const closes = candles.map((candle) => candle.close);
    const volumes = candles.map((candle) => candle.volume);
    const latest = candles[candles.length - 1];
    const previousClose = closes[closes.length - 12] ?? closes[0] ?? latest?.close ?? 0;
    const emaFast = calculateEma(closes, 12) ?? latest?.close ?? 0;
    const emaSlow = calculateEma(closes, 34) ?? emaFast;
    const trendPercent = percent(emaFast - emaSlow, emaSlow);
    const momentumPercent = percent((latest?.close ?? 0) - previousClose, previousClose);
    const volatilityPercent = average(candles.slice(-20).map(candleRangePercent));
    const rangeHigh = Math.max(...candles.slice(-30).map((candle) => candle.high));
    const rangeLow = Math.min(...candles.slice(-30).map((candle) => candle.low));
    const rangePercent = percent(rangeHigh - rangeLow, latest?.close ?? 0);
    const volumeAverage = average(volumes.slice(-21, -1));
    const volumeRatio = volumeAverage > 0 ? (latest?.volume ?? 0) / volumeAverage : 0;
    const wickAnomalyScore = average(candles.slice(-8).map(wickAnomaly));
    const trendStrength = clamp(Math.abs(trendPercent) * 18 + Math.abs(momentumPercent) * 4, 0, 100);

    const regime = this.resolveRegime({
      trendPercent,
      momentumPercent,
      volatilityPercent,
      rangePercent,
      volumeRatio,
      wickAnomalyScore,
      trendStrength,
    });
    const trendDirection = this.resolveTrend(trendPercent, momentumPercent, trendStrength);
    const strategyMode = this.resolveStrategyMode(regime);
    const tradeAllowed = regime !== "MANIPULATION_ZONE" && regime !== "LOW_VOLATILITY";

    return {
      symbol: snapshot.symbol,
      regime,
      trendDirection,
      strategyMode,
      tradeAllowed,
      confidence: this.confidence(regime, trendStrength, volatilityPercent, volumeRatio, wickAnomalyScore),
      reasons: this.reasons(regime, trendDirection, volatilityPercent, trendStrength, volumeRatio, wickAnomalyScore),
      metrics: {
        volatilityPercent: Number(volatilityPercent.toFixed(4)),
        trendStrength: Number(trendStrength.toFixed(2)),
        rangePercent: Number(rangePercent.toFixed(4)),
        volumeRatio: Number(volumeRatio.toFixed(4)),
        wickAnomalyScore: Number(wickAnomalyScore.toFixed(4)),
      },
      detectedAt: new Date().toISOString(),
    };
  }

  private resolveRegime(input: {
    trendPercent: number;
    momentumPercent: number;
    volatilityPercent: number;
    rangePercent: number;
    volumeRatio: number;
    wickAnomalyScore: number;
    trendStrength: number;
  }): MarketRegimeType {
    if (input.wickAnomalyScore >= 3.2 && input.volumeRatio >= 1.8) return "MANIPULATION_ZONE";
    if (input.volatilityPercent >= 3.8 || input.rangePercent >= 8) return "HIGH_VOLATILITY";
    if (input.volatilityPercent <= 0.45 && input.rangePercent <= 1.2) return "LOW_VOLATILITY";
    if (input.trendStrength >= 34 && input.trendPercent > 0 && input.momentumPercent > 0) return "TRENDING_BULLISH";
    if (input.trendStrength >= 34 && input.trendPercent < 0 && input.momentumPercent < 0) return "TRENDING_BEARISH";
    return "SIDEWAYS";
  }

  private resolveTrend(trendPercent: number, momentumPercent: number, trendStrength: number): TrendDirection {
    if (trendStrength < 18) return "SIDEWAYS";
    if (trendPercent > 0 && momentumPercent >= 0) return "BULLISH";
    if (trendPercent < 0 && momentumPercent <= 0) return "BEARISH";
    return "SIDEWAYS";
  }

  private resolveStrategyMode(regime: MarketRegimeType): StrategyMode {
    if (regime === "SIDEWAYS") return "SCALPING";
    if (regime === "TRENDING_BULLISH" || regime === "TRENDING_BEARISH") return "TREND";
    if (regime === "HIGH_VOLATILITY") return "BREAKOUT";
    if (regime === "MANIPULATION_ZONE") return "DISABLED";
    return "DEFENSIVE";
  }

  private confidence(regime: MarketRegimeType, trendStrength: number, volatilityPercent: number, volumeRatio: number, wickAnomalyScore: number) {
    const base = regime === "SIDEWAYS" ? 58 : 62;
    const score = base + trendStrength * 0.18 + Math.min(volumeRatio, 3) * 5 + volatilityPercent * 2 - wickAnomalyScore * 4;
    return Number(clamp(score, 0, 100).toFixed(2));
  }

  private reasons(regime: MarketRegimeType, trend: TrendDirection, volatility: number, trendStrength: number, volumeRatio: number, wickAnomalyScore: number) {
    return [
      `regime=${regime}`,
      `trend=${trend}`,
      `volatility=${volatility.toFixed(2)}%`,
      `trendStrength=${trendStrength.toFixed(2)}`,
      `volumeRatio=${volumeRatio.toFixed(2)}`,
      `wickAnomaly=${wickAnomalyScore.toFixed(2)}`,
    ];
  }
}
