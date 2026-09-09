import { describe, it, expect } from "vitest";
import { equityFolds, weeklyBootstrap, contribution } from "@/src/server/trade-decision-core/validation-evidence.service";
import { RESEARCH_VARIANTS } from "@/src/server/trade-decision-core/entry-signal.service";
import { getVariantById, evaluateUnifiedEntryDecision } from "@/src/server/trade-decision-core/trade-decision-core.service";
import type { ExternalSymbolPanel } from "@/src/server/alpha-engine-v2/external-market-data.types";
const DAY = 86400000;
describe("validation evidence and frozen hypotheses", () => {
    it("uses mark-to-market fold deltas and includes losses carried across a boundary", () => {
        const points = Array.from({ length: 30 }, (_, i) => ({ atMs: (i + 1) * DAY - 1, cashTry: 900, equityTry: 1000 + (i + 1) * 10, openPositions: 1 }));
        const folds = equityFolds(points, 0, 30 * DAY - 1, 1000);
        expect(folds.map(x => x.netPnlTry)).toEqual([150, 150]);
        expect(weeklyBootstrap(points, 1000)).toEqual(weeklyBootstrap(points, 1000));
        expect(weeklyBootstrap(points, 1000).lowerDailyMeanPct).toBeGreaterThan(0);
    });
    it("does not promote research strategies through production lookup", () => {
        for (const v of RESEARCH_VARIANTS)
            expect(() => getVariantById(v.id)).toThrow("Unknown variant");
        expect(contribution([]).topSymbolContributionPct).toBe(0);
    });
    it("research trend uses completed breakout history and causal rank with no OI", () => {
        const bars = Array.from({ length: 300 }, (_, i) => ({ openTime: i * 3600000, closeTime: (i + 1) * 3600000 - 1, open: 100 + i, high: 100 + i + .1, low: 100 + i - .1, close: 100 + i, volume: 1000, quoteVolume: 10000, takerBuyQuote: 5000 }));
        const p = { symbol: "BTCUSDT", bars, funding: [], openInterest: [] } as unknown as ExternalSymbolPanel;
        const idx = 263, now = bars[idx].closeTime;
        const snapshot = { nowMs: now, baseAsset: "BTC", externalSymbol: p.symbol, executionSymbol: "BTCTRY", externalBarIdx: idx, externalClose: bars[idx].close, tryBarIdx: 0, tryPrice: 4000, tryVolume: 1000, tryAvailableAtMs: now, btcExternalReturn4hPct: 1, relativeStrengthRank: 1 };
        const evaluate = (variant = RESEARCH_VARIANTS[0], rank = 1) => evaluateUnifiedEntryDecision({ variant, panel: p, barIdx: idx, snapshot: { ...snapshot, relativeStrengthRank: rank }, nowMs: now });
        const before = evaluate();
        expect(before).not.toBeNull();
        expect(before?.invalidationCurrency).toBe("TRY");
        for (let i = 264; i < 300; i++)
            bars[i].close = 1e9;
        expect(evaluate()).toEqual(before);
        expect(evaluate(RESEARCH_VARIANTS[1], 4)).toBeNull();
        expect(evaluate(RESEARCH_VARIANTS[1], 1)).not.toBeNull();
    });
});

import {currencyAdjustedReturn,spotHoldBenchmark} from "@/src/server/trade-decision-core/research-benchmarks.service";
import type {TryBar} from "@/src/server/trade-decision-core/types";
import type {TrySpotPanel} from "@/src/server/trade-decision-core/try-dataset-loader.service";
it("benchmarks retain cash when there is no fill and translate FX using as-of prices",()=>{
  const b=(at:number,price:number,volume=1000):TryBar=>({openTime:at,closeTime:at,open:price,high:price,low:price,close:price,volume,quoteVolume:volume*price,takerBuyQuote:0});
  const empty={executionBarsTRY:[b(60000,100,0)]} as TrySpotPanel;
  expect(spotHoldBenchmark([empty],0,120000).netPnlTry).toBe(0);
  const fx=[b(0,40),b(120000,50),b(180000,1000)];
  expect(currencyAdjustedReturn(fx,0,120000,10000,12500).returnUsdtPct).toBeCloseTo(0,10);
});
