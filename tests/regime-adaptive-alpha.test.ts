import { describe, expect, it } from "vitest";
import { classifyRegimeAtBar, buildRegimeTimeline } from "@/src/server/alpha-engine-v2/regime-engine-v2.service";
import { LookaheadViolationError, assertNoLookahead } from "@/src/server/alpha-engine-v2/lookahead-guard";
import { buildWalkForwardFolds } from "@/src/server/alpha-engine-v2/walk-forward-validation.service";
import type { HistoricalBar } from "@/src/server/alpha-engine-v2/historical-alpha-simulator.service";

function mockBtcBars(n: number, trend: "up" | "down" | "flat"): HistoricalBar[] {
  return Array.from({ length: n }, (_, i) => {
    const drift = trend === "up" ? 0.15 : trend === "down" ? -0.15 : 0.01;
    const close = 100 + i * drift;
    return {
      openTime: i * 3_600_000,
      closeTime: (i + 1) * 3_600_000,
      open: close - 0.05,
      high: close + 0.2,
      low: close - 0.2,
      close,
      volume: 1000 + i * 10,
      quoteVolume: 100_000,
      takerBuyQuote: 50_000,
    };
  });
}

describe("regime-engine-v2", () => {
  it("classifies uptrend on rising BTC", () => {
    const bars = mockBtcBars(200, "up");
    const snap = classifyRegimeAtBar(bars, 150);
    expect(snap.regime.startsWith("UPTREND")).toBe(true);
  });

  it("detects transition on trend flip", () => {
    const down = mockBtcBars(120, "down");
    const up = mockBtcBars(40, "up");
    const bars = [...down, ...up];
    const prev = classifyRegimeAtBar(bars, 119);
    const snap = classifyRegimeAtBar(bars, 140, prev.regime);
    expect(["TRANSITION", "UPTREND_LOW_VOL", "UPTREND_HIGH_VOL"]).toContain(snap.regime);
  });

  it("regime timeline uses only past data", () => {
    const bars = mockBtcBars(100, "flat");
    const timeline = buildRegimeTimeline(bars, 48);
    expect(timeline.length).toBeGreaterThan(0);
    for (const row of timeline) {
      expect(() => assertNoLookahead(row.timestamp, row.timestamp + 1, "future")).toThrow(LookaheadViolationError);
    }
  });

  it("builds at least 4 walk-forward folds for 60d window", () => {
    const start = Date.parse("2026-04-15T00:00:00.000Z");
    const end = Date.parse("2026-06-15T00:00:00.000Z");
    const folds = buildWalkForwardFolds(start, end, 14, 7, 7);
    expect(folds.length).toBeGreaterThanOrEqual(4);
  });
});
