import { expect, it } from "vitest";
import { executionSignalMetadata, depthSlippageBps } from "@/src/server/execution/execution-signal-metadata.service";
import { executionMarketFixture } from "./helpers/execution-market-fixture";
import type { MarketContext } from "@/src/types/scanner";
it("preserves signal ratios and age without transplanting foreign-quote price targets or costs", () => {
  const stamp = new Date(Date.now() - 120000).toISOString();
  const source = { symbol: "BTCUSDT", metadata: { marketDataTimestamp: stamp, priceAcceleration: .8, relativeStrength: .7,
    stopPrice: 900, targetPrice: 1000, expectedSlippageBps: 99, takerFeePercent: 0 } } as unknown as MarketContext;
  const meta = executionSignalMetadata(source, executionMarketFixture(), 1000);
  expect(meta.marketDataTimestamp).toBe(stamp); expect(meta.priceAcceleration).toBe(.8);
  expect(meta.signalFeatureSymbol).toBe("BTCUSDT"); expect(meta.marketDataVenue).toBe("BINANCE_TR");
  expect(meta).not.toHaveProperty("stopPrice"); expect(meta.expectedSlippageBps).toBeCloseTo(0);
  expect(meta.takerFeePercent).toBeGreaterThan(0);
});
it("does not invent missing evidence or liquidity and refuses depth estimates without coverage", () => {
  const source = { symbol: "BTCUSDT", metadata: {} } as unknown as MarketContext;
  const meta = executionSignalMetadata(source, executionMarketFixture());
  expect(meta.marketDataTimestamp).toBeNull(); expect(meta.relativeStrength).toBeNull(); expect(meta.expectedSlippageBps).toBeNull();
  expect(depthSlippageBps([{ price: 100, quantity: 1 }], 200)).toBeNull();
  expect(depthSlippageBps([{ price: 100, quantity: 1 }, { price: 101, quantity: 1 }], 201)).toBeCloseTo(50);
});

it("converts measured execution regime percentages only when source probabilities are missing", () => {
  const source = { symbol: "BTCTRY", metadata: { regimeChaosProbability: .12 } } as unknown as MarketContext;
  const context = { metadata: { regimeTransitionProbability: 65, regimeChaosProbability: 90 } } as unknown as MarketContext;
  const meta = executionSignalMetadata(source, executionMarketFixture(), 1000, context);
  expect(meta.regimeTransitionProbability).toBe(.65); expect(meta.regimeChaosProbability).toBe(.12);
});
