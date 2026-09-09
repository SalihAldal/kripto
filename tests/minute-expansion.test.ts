import { describe, expect, it } from "vitest";
import { OPPORTUNITY_VARIANTS } from "@/src/server/trade-decision-core/entry-signal.service";
import { evaluateUnifiedEntryDecision, getVariantById } from "@/src/server/trade-decision-core/trade-decision-core.service";
import { expansionTrailingStop } from "@/src/server/trade-decision-core/minute-expansion-entry.service";
import { runTrySpotReplayUniverse } from "@/src/server/alpha-engine-v2/try-spot-replay.service";
import type { TrySpotPanel } from "@/src/server/trade-decision-core/try-dataset-loader.service";
import type { MarketSnapshot } from "@/src/server/trade-decision-core/types";
const H = 3600000, M = 60000;
const variant = OPPORTUNITY_VARIANTS.find(v => v.id === "research_minute_risk_trail")!;
function fixture() {
  const bars = Array.from({ length: 52 }, (_, i) => ({ openTime: i * H, closeTime: (i + 1) * H - 1, open: 100, high: 101, low: 99, close: 100, volume: 1000, quoteVolume: 100000, takerBuyQuote: 50000 }));
  const executionBarsTRY = Array.from({ length: 85 }, (_, i) => {
    const close = i >= 74 ? 101 : 100, volume = i >= 60 ? 10000 : 1000;
    return { openTime: 48 * H + i * M, closeTime: 48 * H + (i + 1) * M - 1, open: close, high: close + .1, low: close - .1, close, volume, quoteVolume: close * volume, takerBuyQuote: close * volume / 2 };
  });
  const panel = { symbol: "BTCUSDT", baseAsset: "BTC", executionSymbol: "BTCTRY", bars, executionBarsTRY, funding: [], openInterest: [] } as unknown as TrySpotPanel;
  const snapshot: MarketSnapshot = { nowMs: executionBarsTRY[74].closeTime, baseAsset: "BTC", externalSymbol: "BTCUSDT", executionSymbol: "BTCTRY", externalBarIdx: 48, externalClose: 100,
    tryBarIdx: 74, tryPrice: 101, tryVolume: 10000, tryAvailableAtMs: executionBarsTRY[74].closeTime, btcExternalReturn4hPct: 0, executionEstimate: { feePerSidePct: .15, slippageBpsPerSide: 7 } };
  return { panel, snapshot };
}
const decide = (f: ReturnType<typeof fixture>) => evaluateUnifiedEntryDecision({ ...f, variant, barIdx: 48, nowMs: f.snapshot.nowMs });
describe("minute expansion causal research", () => {
  it("decides between hourly closes and ignores all future rows", () => {
    const f = fixture(), expected = decide(f);
    expect(expected).not.toBeNull();
    expect(expected!.signalAtMs).toBe(f.snapshot.nowMs);
    for (const b of f.panel.bars.slice(49)) b.close = 1;
    for (const b of f.panel.executionBarsTRY.slice(75)) b.close = 999;
    expect(decide(f)).toEqual(expected);
    expect(() => getVariantById(variant.id)).toThrow();
  });
  it("rejects noncontiguous local history and no-volume breakouts", () => {
    const f = fixture(); f.panel.executionBarsTRY[70].closeTime++;
    expect(decide(f)).toBeNull();
    const g = fixture(); g.panel.executionBarsTRY[74].volume = 0;
    expect(decide(g)).toBeNull();
  });
  it("fills after the five-minute decision, without waiting for an external hour", () => {
    const { panel, snapshot } = fixture();
    const run = runTrySpotReplayUniverse({ panels: [panel], btcPanel: panel, variant, periodStart: snapshot.nowMs, periodEnd: snapshot.nowMs + 5 * M, freshPartialStart: 100 * H });
    expect(run.openPositions).toHaveLength(1);
    expect(run.openPositions[0].entryAtMs).toBe(snapshot.nowMs + M);
    expect(run.portfolio.cashTry).toBeLessThan(10000);
  });
  it("keeps initial risk until 2R then trails by 1R", () => {
    expect(expansionTrailingStop(100, 98, 103.9)).toBe(98);
    expect(expansionTrailingStop(100, 98, 104)).toBe(102);
    expect(expansionTrailingStop(100, 98, 120)).toBe(118);
  });
});
