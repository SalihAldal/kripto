import { describe, expect, it } from "vitest";
import { fundingPnlDuringHold } from "@/src/server/alpha-engine-v2/cost-model-v2.service";
import {
  buildFundingEventFeatures,
  DEFAULT_FUNDING_BASIS_THRESHOLDS,
  evaluateFundingEventSignal,
  FUNDING_BASIS_ALPHA_V3_ID,
  runFundingBasisEventSimulation,
} from "@/src/server/alpha-engine-v2/funding-basis-alpha-v3.service";
import type { FundingBasisPanel } from "@/src/server/alpha-engine-v2/funding-basis-data.service";
import { buildFundingWalkForwardFolds } from "@/src/server/alpha-engine-v2/funding-basis-walk-forward.service";
import { assertNoLookahead, LookaheadViolationError } from "@/src/server/alpha-engine-v2/lookahead-guard";

function mockPanel(overrides?: Partial<FundingBasisPanel>): FundingBasisPanel {
  const bars = Array.from({ length: 200 }, (_, i) => ({
    openTime: i * 3_600_000,
    closeTime: (i + 1) * 3_600_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100 + (i % 5 === 0 ? -2 : 0.1),
    volume: 1000 + i,
    quoteVolume: 100_000,
    takerBuyQuote: 50_000,
  }));
  const funding = Array.from({ length: 60 }, (_, i) => ({
    fundingTime: (i + 20) * 8 * 3_600_000,
    fundingRate: i % 10 === 0 ? 0.002 : i % 10 === 1 ? -0.002 : 0.0001,
  }));
  const basis = bars.map((b) => ({ closeTime: b.closeTime, premium: b.close > 100 ? 0.001 : -0.001 }));
  return {
    symbol: "ETHUSDT",
    bars,
    funding,
    basis,
    dataStates: { ohlcv: "AVAILABLE", funding: "AVAILABLE", basis: "AVAILABLE" },
    fundingEventCount: funding.length,
    ...overrides,
  };
}

describe("funding-basis-alpha-v3", () => {
  it("uses funding rate as raw fraction and exposes bps consistently", () => {
    const panel = mockPanel();
    const features = buildFundingEventFeatures({
      panel,
      btc: panel.bars,
      eventIdx: 25,
      historyFunding: panel.funding.slice(0, 25).map((f) => f.fundingRate),
      historyBasis: panel.basis.map((b) => b.premium),
      historyAccel: [0.0001, 0.0002],
    });
    expect(features).not.toBeNull();
    expect(features!.fundingRate).toBeLessThan(0.01);
    expect(features!.fundingRateBps).toBeCloseTo(features!.fundingRate * 10_000, 4);
  });

  it("returns CASH when funding data unavailable", () => {
    const panel = mockPanel({
      dataStates: { ohlcv: "AVAILABLE", funding: "UNAVAILABLE", basis: "AVAILABLE" },
    });
    const run = runFundingBasisEventSimulation({
      panels: [panel],
      btc: panel.bars,
      startTime: 0,
      endTime: 1_000_000_000,
      thresholds: DEFAULT_FUNDING_BASIS_THRESHOLDS,
      split: "TEST",
    });
    expect(run.trades).toHaveLength(0);
  });

  it("applies funding payment sign for long and short", () => {
    const events = [{ fundingTime: 50_000, fundingRate: 0.001 }];
    expect(fundingPnlDuringHold("LONG", events, 0, 100_000)).toBeCloseTo(-0.1, 4);
    expect(fundingPnlDuringHold("SHORT", events, 0, 100_000)).toBeCloseTo(0.1, 4);
  });

  it("blocks lookahead on funding event alignment", () => {
    expect(() => assertNoLookahead(1000, 2000, "funding")).toThrow(LookaheadViolationError);
  });

  it("evaluates extreme positive funding as short candidate", () => {
    const features = buildFundingEventFeatures({
      panel: mockPanel(),
      btc: mockPanel().bars,
      eventIdx: 20,
      historyFunding: Array.from({ length: 20 }, () => 0.00005),
      historyBasis: Array.from({ length: 20 }, () => 0.0005),
      historyAccel: Array.from({ length: 19 }, () => 0),
    });
    expect(features).not.toBeNull();
    features!.fundingRate = 0.003;
    features!.fundingPercentile = 95;
    features!.basisPercentile = 90;
    features!.priceReturn4h = -1;
    features!.priceReturn12h = 2;
    const signal = evaluateFundingEventSignal(features!, DEFAULT_FUNDING_BASIS_THRESHOLDS, true);
    expect(signal?.side).toBe("SHORT");
    expect(signal?.alphaId).toBe("FUNDING_DISLOCATION_SHORT");
  });

  it("produces at least 4 walk-forward folds for 90d window", () => {
    const start = Date.parse("2026-02-01T00:00:00.000Z");
    const end = Date.parse("2026-05-01T00:00:00.000Z");
    const folds = buildFundingWalkForwardFolds(start, end);
    expect(folds.length).toBeGreaterThanOrEqual(4);
  });

  it("tags trades with FUNDING_BASIS_ALPHA_V3 id", () => {
    const panel = mockPanel();
    const run = runFundingBasisEventSimulation({
      panels: [panel],
      btc: panel.bars,
      startTime: 20 * 8 * 3_600_000,
      endTime: 50 * 8 * 3_600_000,
      thresholds: { ...DEFAULT_FUNDING_BASIS_THRESHOLDS, variant: "FUNDING_ONLY" },
      split: "TEST",
    });
    if (run.trades.length) {
      expect(run.trades[0].alphaId).toBe(FUNDING_BASIS_ALPHA_V3_ID);
    }
  });
});
