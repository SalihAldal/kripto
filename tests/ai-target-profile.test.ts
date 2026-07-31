import { describe, expect, it } from "vitest";
import { computeDirectionalProfitPercent, normalizeAiModelOutput } from "../src/server/ai/normalize-model-output";
import type { AIModelOutput } from "../src/types/ai";

function output(overrides: Partial<AIModelOutput>): AIModelOutput {
  return {
    decision: "BUY",
    confidence: 55,
    riskScore: 35,
    targetPrice: 99,
    stopPrice: 101,
    estimatedDurationSec: 3000,
    reasoningShort: "test",
    metadata: {},
    ...overrides,
  };
}

describe("AI target normalization", () => {
  it("BUY hedefi fiyat altinda geldiyse pozitif hedefe normalize eder", () => {
    const normalized = normalizeAiModelOutput({
      output: output({ decision: "BUY", targetPrice: 99, stopPrice: 101 }),
      analysisInput: { lastPrice: 100 },
      minProfitPercent: 1,
      maxDurationSec: 600,
    });
    expect(normalized?.targetPrice).toBeGreaterThan(100);
    expect(normalized?.stopPrice).toBeLessThan(100);
    expect(normalized?.estimatedDurationSec).toBe(600);
  });

  it("SELL hedefi fiyat ustunde geldiyse asagi yone normalize eder", () => {
    const normalized = normalizeAiModelOutput({
      output: output({ decision: "SELL", targetPrice: 101, stopPrice: 99 }),
      analysisInput: { lastPrice: 100 },
      minProfitPercent: 1,
      maxDurationSec: 600,
    });
    expect(normalized?.targetPrice).toBeLessThan(100);
    expect(normalized?.stopPrice).toBeGreaterThan(100);
  });

  it("yon bazli profit hesabi karsi yon hedefini pozitif saymaz", () => {
    expect(computeDirectionalProfitPercent({ side: "BUY", entryPrice: 100, targetPrice: 99 })).toBeLessThan(0);
    expect(computeDirectionalProfitPercent({ side: "SELL", entryPrice: 100, targetPrice: 99 })).toBeGreaterThan(0);
  });
});
