import { describe, expect, it } from "vitest";
import { assessKlineInput } from "@/src/server/market-data/kline-input-contract.service";
import type { KlineItem } from "@/src/types/exchange";

function buildHistoricalKlines(anchorMs: number, count = 25): KlineItem[] {
  return Array.from({ length: count }).map((_, i) => ({
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
    openTime: anchorMs - (count - i) * 60_000,
    closeTime: anchorMs - (count - i - 1) * 60_000 - 1,
  }));
}

describe("replayClockMs kline freshness", () => {
  it("uses replay clock so historical candles are fresh at decision time", () => {
    const replayClockMs = Date.parse("2026-09-05T12:00:00.000Z");
    const klines = buildHistoricalKlines(replayClockMs);
    const liveNow = Date.now();
    const liveAssessment = assessKlineInput({ klines, nowMs: liveNow });
    const replayAssessment = assessKlineInput({ klines, nowMs: replayClockMs });
    expect(liveAssessment.fresh).toBe(false);
    expect(liveAssessment.reasonCode).toBe("KLINE_TOO_OLD");
    expect(replayAssessment.fresh).toBe(true);
    expect(replayAssessment.reasonCode).toBeNull();
  });

  it("runtime without replayClockMs still uses wall clock semantics", () => {
    const now = Date.now();
    const klines = buildHistoricalKlines(now - 30_000);
    const assessment = assessKlineInput({ klines, nowMs: now });
    expect(assessment.fresh).toBe(true);
  });
});
