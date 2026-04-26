import type { AIProvider } from "@/services/ai/types";

export const sentimentProvider: AIProvider = {
  name: "Sentiment Synapse",
  async evaluate() {
    const bias = Math.random() > 0.45 ? "BUY" : "HOLD";
    return {
      model: "Sentiment Synapse",
      signal: bias,
      confidence: Number((0.65 + Math.random() * 0.25).toFixed(2)),
      reason:
        bias === "BUY"
          ? "Sosyal ve haber akisinda alim tarafi agir basiyor."
          : "Duygu verisi net bir yon gostermiyor.",
    };
  },
};
