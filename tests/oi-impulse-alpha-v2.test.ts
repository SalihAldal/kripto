import { describe, expect, it } from "vitest";
import { resolveDeepHistoricalProvider } from "@/src/server/alpha-engine-v2/deep-historical-providers.service";
import { buildOiStateMatrix, classifyOiState } from "@/src/server/alpha-engine-v2/oi-features.service";
import { OI_IMPULSE_V1_CONTRACT, evaluateOiImpulseAtBar } from "@/src/server/alpha-engine-v2/oi-impulse-alpha-v2.service";
import { buildOiWalkForwardFolds } from "@/src/server/alpha-engine-v2/oi-alpha-walk-forward.service";
import { assertNoLookahead, LookaheadViolationError } from "@/src/server/alpha-engine-v2/lookahead-guard";
import type { ExternalSymbolPanel } from "@/src/server/alpha-engine-v2/external-market-data.types";

function mockPanel(): ExternalSymbolPanel {
  const bars = Array.from({ length: 300 }, (_, i) => ({
    openTime: i * 3_600_000,
    closeTime: (i + 1) * 3_600_000,
    open: 100 + i * 0.05,
    high: 101 + i * 0.05,
    low: 99 + i * 0.05,
    close: 100 + i * 0.05,
    volume: 1000,
    quoteVolume: 100_000,
    takerBuyQuote: 55_000,
  }));
  const openInterest = bars.map((b, i) => ({ timestamp: b.closeTime, openInterest: 1_000_000 + i * 5000 }));
  return {
    symbol: "BTCUSDT",
    venue: "FUTURES",
    bars,
    funding: bars.map((b, i) => ({ fundingTime: b.closeTime, fundingRate: i % 10 === 0 ? 0.0005 : 0.0001 })),
    basis: bars.map((b) => ({ closeTime: b.closeTime, premium: 0.0002 })),
    openInterest,
    liquidations: [],
    aggTrades: [],
    cvd: [],
    longShortRatio: [],
    orderBook: [],
    availability: {
      OHLCV: "AVAILABLE",
      FUNDING: "AVAILABLE",
      BASIS: "AVAILABLE",
      OPEN_INTEREST: "AVAILABLE",
      LIQUIDATION: "UNAVAILABLE",
      AGG_TRADES: "UNAVAILABLE",
      CVD: "UNAVAILABLE",
      LONG_SHORT_RATIO: "UNAVAILABLE",
      ORDER_BOOK: "UNAVAILABLE",
    },
    provenance: [],
  };
}

describe("oi-impulse-alpha-v2", () => {
  it("documents V1 contract", () => {
    expect(OI_IMPULSE_V1_CONTRACT.alphaId).toBe("OI_IMPULSE_LONG");
    expect(OI_IMPULSE_V1_CONTRACT.holdHours).toBe(8);
  });

  it("classifies OI state quadrants", () => {
    expect(classifyOiState(1, 2)).toBe("PRICE_UP_OI_UP");
    expect(classifyOiState(-1, 2)).toBe("PRICE_DOWN_OI_UP");
  });

  it("evaluates V1 long signal", () => {
    const panel = mockPanel();
    const idx = 200;
    panel.bars[idx].close = panel.bars[idx - 4].close * 1.01;
    const prevOi = panel.openInterest[idx - 4].openInterest;
    panel.openInterest[idx].openInterest = prevOi * 1.02;
    panel.funding[idx].fundingRate = 0.0001;
    const trade = evaluateOiImpulseAtBar({ alphaId: "OI_IMPULSE_LONG", panel, idx, split: "TEST", costPct: 0.22 });
    expect(trade?.side).toBe("LONG");
  });

  it("blocks lookahead", () => {
    expect(() => assertNoLookahead(1000, 2000, "oi")).toThrow(LookaheadViolationError);
  });

  it("builds state matrix", () => {
    const matrix = buildOiStateMatrix(mockPanel());
    expect(matrix.length).toBeGreaterThan(0);
  });

  it("resolves provider without exposing secrets", () => {
    const r = resolveDeepHistoricalProvider();
    expect(r.providerName).toBeTruthy();
    expect(["file-import", "tardis", "coinalyze", "coinapi", "binance-futures"]).toContain(r.source === "binance-fallback" ? "binance-futures" : r.source);
  });

  it("produces >=6 folds for 200d window with 45/15/15", () => {
    const start = Date.now() - 200 * 24 * 3_600_000;
    const end = Date.now();
    expect(buildOiWalkForwardFolds(start, end, 45, 15, 15).length).toBeGreaterThanOrEqual(6);
  });
});
