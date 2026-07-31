import { describe, expect, it } from "vitest";
import { Provider1Adapter } from "../src/server/ai/providers/provider-1.adapter";
import { Provider2Adapter } from "../src/server/ai/providers/provider-2.adapter";
import { Provider3Adapter } from "../src/server/ai/providers/provider-3.adapter";
import type { AIAnalysisInput, AIProviderConfig } from "../src/types/ai";

const cfg: AIProviderConfig = {
  id: "p",
  name: "provider-test",
  enabled: true,
  timeoutMs: 1200,
  weight: 1,
};

const input: AIAnalysisInput = {
  symbol: "BTCUSDT",
  lastPrice: 100,
  volume24h: 20_000_000,
  spread: 0.08,
  volatility: 1.1,
  orderBookSummary: { bestBid: 99.9, bestAsk: 100.1, bidDepth: 1200, askDepth: 900 },
  recentTradesSummary: { buyVolume: 500, sellVolume: 400, buySellRatio: 1.25 },
  klines: Array.from({ length: 25 }).map((_, i) => ({
    open: 99 + i * 0.05,
    high: 100 + i * 0.05,
    low: 98 + i * 0.05,
    close: 99.5 + i * 0.05,
    volume: 1000 + i * 3,
    openTime: i * 60_000,
    closeTime: i * 60_000 + 59_000,
  })),
};

describe("mock ai providers", () => {
  it("provider outputs valid decisions", async () => {
    const adapters = [new Provider1Adapter(cfg), new Provider2Adapter(cfg), new Provider3Adapter(cfg)];
    for (const adapter of adapters) {
      const out = await adapter.analyzeTechnicalSignal(input);
      expect(["BUY", "SELL", "HOLD", "NO_TRADE"]).toContain(out.decision);
      expect(out.confidence).toBeGreaterThanOrEqual(0);
      expect(out.confidence).toBeLessThanOrEqual(100);
    }
  });
});
