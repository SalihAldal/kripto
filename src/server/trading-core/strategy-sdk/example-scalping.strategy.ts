import { defineTradingStrategy } from "@/src/server/trading-core/strategy-sdk/strategy-builder";

export const exampleScalpingStrategy = defineTradingStrategy({
  meta: {
    name: "example-scalping-sdk",
    version: "1.0.0",
    description: "Template strategy showing generateSignal, validateRisk and executeTrade hooks.",
    mode: "SCALPING",
    minScore: 62,
    riskProfile: "MID",
    enabled: false,
  },

  generateSignal({ snapshot, indicators, config }) {
    const reasons: string[] = [];
    let side: "BUY" | "SELL" | "HOLD" = "HOLD";
    let score = 50;

    if (indicators.rsi !== undefined && indicators.rsi < 35) {
      side = "BUY";
      score += 18;
      reasons.push(`RSI oversold: ${indicators.rsi}`);
    }
    if (indicators.rsi !== undefined && indicators.rsi > 65) {
      side = "SELL";
      score += 18;
      reasons.push(`RSI overbought: ${indicators.rsi}`);
    }
    if (indicators.volumeSpike?.isSpike) {
      score += 10;
      reasons.push(`Volume spike: ${indicators.volumeSpike.ratio}`);
    }

    return {
      side: score >= config.minScore ? side : "HOLD",
      score,
      confidence: Math.max(0, Math.min(100, score - 8)),
      reasons: reasons.length > 0 ? reasons : [`${snapshot.symbol}: no SDK setup found`],
      indicators,
    };
  },

  validateRisk({ signal }) {
    if (signal.confidence < 55) {
      return { allowed: false, reasons: ["Confidence below SDK risk threshold"] };
    }
    return { allowed: true, reasons: ["SDK risk validation passed"] };
  },

  executeTrade({ signal }) {
    return {
      reasons: [`${signal.strategy} delegates execution to TradingCore executor`],
    };
  },
});
