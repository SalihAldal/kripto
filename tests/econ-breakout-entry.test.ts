import { describe, expect, it } from "vitest";
import { evaluateEconBreakoutEntry, ECON_ENTRY_RULES } from "@/src/server/trade-decision-core/econ-breakout-entry.service";
import type { ExternalSymbolPanel } from "@/src/server/alpha-engine-v2/external-market-data.types";
import type { MarketSnapshot, StrategyVariantConfig } from "@/src/server/trade-decision-core/types";

function makeBars(count: number, start = 1_700_000_000_000) {
  const bars = [];
  for (let i = 0; i < count; i++) {
    const close = 100 + i * 0.02 + (i > count - 30 ? 2 : 0);
    bars.push({
      openTime: start + i * 3600000,
      closeTime: start + i * 3600000 + 3599999,
      open: close - 0.1,
      high: close + 0.2,
      low: close - 0.2,
      close,
      volume: 1000,
      quoteVolume: 200_000,
    });
  }
  return bars;
}

function makeMinuteBars(count: number, start: number) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const close = 100 + i * 0.001;
    rows.push({
      openTime: start + i * 60000,
      closeTime: start + i * 60000 + 59999,
      open: close - 0.01,
      high: close + 0.05,
      low: close - 0.05,
      close,
      volume: 50,
      quoteVolume: 5000,
      takerBuyQuote: 2500,
    });
  }
  return rows;
}

describe("evaluateEconBreakoutEntry", () => {
  const variant: StrategyVariantConfig = {
    id: "econ_breakout_rs_pr04",
    entryCandidate: "econ_breakout_rs",
    exitMode: "pr04_trail",
    alphaId: "ECON_BREAKOUT_RS",
    oiFundingRequired: false,
    researchOnly: true,
    label: "test",
  };

  it("rejects when relative strength rank is too weak", () => {
    const bars = makeBars(200);
    const nowMs = bars.at(-1)!.closeTime;
    const minute = makeMinuteBars(200, nowMs - 199 * 60000);
    const panel = { symbol: "TESTUSDT", bars, executionBarsTRY: minute } as ExternalSymbolPanel & { executionBarsTRY: typeof minute };
    const snapshot: MarketSnapshot = {
      nowMs,
      baseAsset: "TEST",
      externalSymbol: "TESTUSDT",
      executionSymbol: "TESTTRY",
      externalBarIdx: bars.length - 1,
      externalClose: bars.at(-1)!.close,
      tryBarIdx: 179,
      tryPrice: minute.at(-1)!.close,
      tryVolume: 50,
      tryAvailableAtMs: minute.at(-1)!.closeTime,
      executionEstimate: { feePerSidePct: 0.15, slippageBpsPerSide: 7 },
      btcExternalReturn4hPct: 0.5,
      relativeStrengthRank: ECON_ENTRY_RULES.rsMaxRank + 1,
    };
    expect(evaluateEconBreakoutEntry({ panel, barIdx: bars.length - 1, snapshot, variant })).toBeNull();
  });

  it("accepts breakout when trend, volume, RS and TRY confirmation align", () => {
    const bars = makeBars(200);
    const nowMs = bars.at(-1)!.closeTime;
    const minute = makeMinuteBars(200, nowMs - 199 * 60000);
    minute[minute.length - 1].high = minute[minute.length - 1].close + 1;
    const panel = { symbol: "TESTUSDT", bars, executionBarsTRY: minute } as ExternalSymbolPanel & { executionBarsTRY: typeof minute };
    const snapshot: MarketSnapshot = {
      nowMs,
      baseAsset: "TEST",
      externalSymbol: "TESTUSDT",
      executionSymbol: "TESTTRY",
      externalBarIdx: bars.length - 1,
      externalClose: bars.at(-1)!.close,
      tryBarIdx: 179,
      tryPrice: minute.at(-1)!.close,
      tryVolume: 50,
      tryAvailableAtMs: minute.at(-1)!.closeTime,
      executionEstimate: { feePerSidePct: 0.15, slippageBpsPerSide: 7 },
      btcExternalReturn4hPct: 0.5,
      relativeStrengthRank: 3,
    };
    const intent = evaluateEconBreakoutEntry({ panel, barIdx: bars.length - 1, snapshot, variant });
    expect(intent?.reasonCodes).toContain("econ_breakout_rs");
    expect(intent?.invalidationCurrency).toBe("TRY");
  });
});
