import type { AIProvider } from "@/services/ai/types";

export const riskProvider: AIProvider = {
  name: "Risk Sentinel",
  async evaluate({ ticker }) {
    const highVol = Math.abs(ticker.change24h) > 5;
    return {
      model: "Risk Sentinel",
      signal: highVol ? "HOLD" : "BUY",
      confidence: highVol ? 0.83 : 0.74,
      reason: highVol
        ? "Volatilite yuksek, daha guvenli giris beklenmeli."
        : "Risk parametreleri pozisyon acmaya izin veriyor.",
    };
  },
};
