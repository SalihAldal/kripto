import { describe, expect, it } from "vitest";
import { evaluateUnifiedEntryDecision, getVariantById } from "@/src/server/trade-decision-core";
import { evaluateEntrySignal } from "@/src/server/trade-decision-core/entry-signal.service";
import type { ExternalSymbolPanel } from "@/src/server/alpha-engine-v2/external-market-data.types";

function mockPanel(): ExternalSymbolPanel & { executionBarsTRY: Array<{ volume: number }> } {
  const bars = Array.from({ length: 120 }, (_, i) => ({
    openTime: i * 3_600_000,
    closeTime: (i + 1) * 3_600_000,
    open: 100 + i * 0.1,
    high: 101 + i * 0.1,
    low: 99 + i * 0.1,
    close: 100 + i * 0.1,
    volume: 1000,
    quoteVolume: 100_000,
    takerBuyQuote: 55_000,
  }));
  const openInterest = bars.map((b, i) => ({ timestamp: b.closeTime, openInterest: 1_000_000 + i * 8000 }));
  return {
    symbol: "BTCUSDT",
    venue: "FUTURES",
    bars,
    funding: bars.map((b) => ({ fundingTime: b.closeTime, fundingRate: 0.0001 })),
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
    executionBarsTRY: bars.map(() => ({ volume: 10 })),
  };
}

describe("trade-decision-core parity", () => {
  it("replay and unified entry return same signal", () => {
    const panel = mockPanel();
    const idx = 80;
    panel.bars[idx].close = panel.bars[idx - 4].close * 1.01;
    panel.openInterest[idx].openInterest = panel.openInterest[idx - 4].openInterest * 1.02;
    const variant = getVariantById("baseline_fixed_8h_v2");
    const snapshot = {
      nowMs: panel.bars[idx].closeTime,
      baseAsset: "BTC",
      externalSymbol: "BTCUSDT",
      executionSymbol: "BTCTRY",
      externalBarIdx: idx,
      externalClose: panel.bars[idx].close,
      tryBarIdx: idx,
      tryPrice: 100,
      tryVolume: 10,
      btcExternalReturn4hPct: 1,
    };
    const a = evaluateEntrySignal({ variant, panel, barIdx: idx, snapshot });
    const b = evaluateUnifiedEntryDecision({ variant, panel, barIdx: idx, snapshot, nowMs: snapshot.nowMs });
    expect(a?.signalId).toBe(b?.signalId);
  });

  it("blocks lookahead when nowMs before snapshot", () => {
    const panel = mockPanel();
    const variant = getVariantById("baseline_fixed_8h_v2");
    const snapshot = {
      nowMs: 1_000_000,
      baseAsset: "BTC",
      externalSymbol: "BTCUSDT",
      executionSymbol: "BTCTRY",
      externalBarIdx: 80,
      externalClose: 100,
      tryBarIdx: 80,
      tryPrice: 100,
      tryVolume: 10,
      btcExternalReturn4hPct: 1,
    };
    expect(evaluateUnifiedEntryDecision({ variant, panel, barIdx: 80, snapshot, nowMs: 500_000 })).toBeNull();
  });
});
