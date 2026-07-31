import type { AIProvider } from "@/services/ai/types";

export const momentumProvider: AIProvider = {
  name: "Momentum Core",
  async evaluate({ ticker }) {
    const bullish = ticker.change24h > 1;
    return {
      model: "Momentum Core",
      signal: bullish ? "BUY" : ticker.change24h < -1 ? "SELL" : "HOLD",
      confidence: Math.min(0.97, 0.55 + Math.abs(ticker.change24h) / 10),
      reason: bullish
        ? "24saatlik momentum pozitif ve hacim destekli."
        : "Momentum yeterli guce ulasamadi.",
    };
  },
};
