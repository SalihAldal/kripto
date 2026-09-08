import { describe, expect, it } from "vitest";
import { fundingPnlDuringHold } from "@/src/server/alpha-engine-v2/cost-model-v2.service";
import { aggregateQaSummary, runExternalDataQa } from "@/src/server/alpha-engine-v2/external-data-qa.service";
import { buildCvdSeries } from "@/src/server/alpha-engine-v2/external-market-data-provider.service";
import type { ExternalSymbolPanel } from "@/src/server/alpha-engine-v2/external-market-data.types";
import {
  computePriceOiQuadrantForensic,
  evaluateExternalAlphaAtBar,
  EXTERNAL_ALPHA_IDS,
} from "@/src/server/alpha-engine-v2/external-microstructure-alpha.service";
import { buildExternalWalkForwardFolds } from "@/src/server/alpha-engine-v2/external-microstructure-walk-forward.service";
import { assertNoLookahead, LookaheadViolationError } from "@/src/server/alpha-engine-v2/lookahead-guard";

function mockPanel(): ExternalSymbolPanel {
  const bars = Array.from({ length: 200 }, (_, i) => ({
    openTime: i * 3_600_000,
    closeTime: (i + 1) * 3_600_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100 + (i % 7 === 0 ? -1 : 0.2),
    volume: 1000,
    quoteVolume: 100_000,
    takerBuyQuote: 55_000,
  }));
  const funding = Array.from({ length: 60 }, (_, i) => ({
    fundingTime: (i + 1) * 8 * 3_600_000,
    fundingRate: i % 5 === 0 ? 0.0005 : -0.0001,
  }));
  const openInterest = bars.map((b, i) => ({ timestamp: b.closeTime, openInterest: 1_000_000 + i * 1000 }));
  const aggTrades = bars.map((b) => ({
    timestamp: b.openTime,
    aggressiveBuyVolume: 50_000,
    aggressiveSellVolume: 40_000,
    delta: 10_000,
    tradeCount: 100,
    avgTradeSize: 900,
    largeBuyFlow: 5_000,
    largeSellFlow: 2_000,
  }));
  const cvd = buildCvdSeries(aggTrades);
  return {
    symbol: "BTCUSDT",
    venue: "FUTURES",
    bars,
    funding,
    basis: bars.map((b) => ({ closeTime: b.closeTime, premium: 0.0002 })),
    openInterest,
    liquidations: [{ timestamp: bars[50].closeTime, side: "SELL", price: 100, qty: 10, notional: 1000 }],
    aggTrades,
    cvd,
    longShortRatio: bars.map((b) => ({ timestamp: b.closeTime, longShortRatio: 1.1, longAccount: 0.55, shortAccount: 0.45 })),
    orderBook: [],
    availability: {
      OHLCV: "AVAILABLE",
      FUNDING: "AVAILABLE",
      BASIS: "AVAILABLE",
      OPEN_INTEREST: "AVAILABLE",
      LIQUIDATION: "AVAILABLE",
      AGG_TRADES: "AVAILABLE",
      CVD: "AVAILABLE",
      LONG_SHORT_RATIO: "AVAILABLE",
      ORDER_BOOK: "UNAVAILABLE",
    },
    provenance: [],
  };
}

describe("external-microstructure-alpha", () => {
  it("builds CVD from real aggTrade buckets", () => {
    const panel = mockPanel();
    expect(panel.cvd.length).toBeGreaterThan(0);
    expect(panel.cvd.at(-1)?.cvd).toBeGreaterThan(0);
  });

  it("blocks lookahead", () => {
    expect(() => assertNoLookahead(1000, 2000, "oi")).toThrow(LookaheadViolationError);
  });

  it("funding sign correct for long/short", () => {
    const events = [{ fundingTime: 5000, fundingRate: 0.001 }];
    expect(fundingPnlDuringHold("LONG", events, 0, 10_000)).toBeCloseTo(-0.1, 4);
    expect(fundingPnlDuringHold("SHORT", events, 0, 10_000)).toBeCloseTo(0.1, 4);
  });

  it("skips order book alpha when unavailable", () => {
    const panel = mockPanel();
    const trade = evaluateExternalAlphaAtBar({
      alphaId: "ORDER_BOOK_IMBALANCE_LONG",
      panel,
      idx: 60,
      split: "TEST",
      costPct: 0.22,
    });
    expect(trade).toBeNull();
  });

  it("runs data QA on panel", () => {
    const panel = mockPanel();
    const reports = runExternalDataQa(panel, panel.bars[0].openTime, panel.bars.at(-1)!.closeTime);
    const summary = aggregateQaSummary(reports);
    expect(summary.find((s) => s.kind === "OHLCV")?.available).toBe(true);
  });

  it("produces OI quadrant forensic", () => {
    const panel = mockPanel();
    const forensic = computePriceOiQuadrantForensic(panel);
    expect(forensic.length).toBeGreaterThan(0);
  });

  it("has minimum walk-forward folds for 90d window", () => {
    const start = Date.parse("2026-02-01T00:00:00.000Z");
    const end = Date.parse("2026-05-01T00:00:00.000Z");
    expect(buildExternalWalkForwardFolds(start, end).length).toBeGreaterThanOrEqual(4);
  });

  it("defines external alpha ids", () => {
    expect(EXTERNAL_ALPHA_IDS).toContain("OI_IMPULSE_LONG");
    expect(EXTERNAL_ALPHA_IDS).toContain("CVD_PRICE_DIVERGENCE_LONG");
  });
});
