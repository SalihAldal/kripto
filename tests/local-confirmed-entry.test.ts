import { describe, expect, it } from "vitest";
import { RESEARCH_VARIANTS } from "@/src/server/trade-decision-core/entry-signal.service";
import { evaluateUnifiedEntryDecision, getVariantById } from "@/src/server/trade-decision-core/trade-decision-core.service";
import { LOCAL_ENTRY_RISK, planLocalEntry, roundTripCostPct } from "@/src/server/trade-decision-core/local-entry-risk.service";
import { runTrySpotReplayUniverse } from "@/src/server/alpha-engine-v2/try-spot-replay.service";
import type { TrySpotPanel } from "@/src/server/trade-decision-core/try-dataset-loader.service";
import type { MarketSnapshot } from "@/src/server/trade-decision-core/types";
const H = 3600000, M = 60000;
const variant = RESEARCH_VARIANTS.find(v => v.id === "research_local_breakout")!;
function fixture() {
    const bars = Array.from({ length: 181 }, (_, i) => ({ openTime: i * H, closeTime: (i + 1) * H - 1, open: 100 + i * .05, close: 100 + i * .05, high: 101 + i * .05, low: 99 + i * .05, volume: 1000, quoteVolume: 100000, takerBuyQuote: 50000 }));
    bars[180] = { ...bars[180], open: 109, close: 112, high: 113, low: 108, quoteVolume: 500000 };
    const executionBarsTRY = Array.from({ length: 240 }, (_, i) => {
        const price = i < 120 ? 100 : i < 179 ? 100.3 : 101;
        return { openTime: 178 * H + i * M, closeTime: 178 * H + (i + 1) * M - 1, open: price, close: price, high: price + .1, low: i < 180 ? 99.8 : price - .1, volume: 2000, quoteVolume: 2000 * price, takerBuyQuote: 1000 * price };
    });
    const panel = { symbol: "BTCUSDT", baseAsset: "BTC", executionSymbol: "BTCTRY", bars, executionBarsTRY, openInterest: [], funding: [] } as unknown as TrySpotPanel;
    const snapshot: MarketSnapshot = { nowMs: bars[180].closeTime, baseAsset: "BTC", externalSymbol: "BTCUSDT", executionSymbol: "BTCTRY", externalBarIdx: 180, externalClose: 112,
        tryBarIdx: 179, tryPrice: 101, tryVolume: 2000, tryAvailableAtMs: bars[180].closeTime, btcExternalReturn4hPct: 1, executionEstimate: { feePerSidePct: .15, slippageBpsPerSide: 7 } };
    return { panel, snapshot };
}
const decision = (f = fixture()) => evaluateUnifiedEntryDecision({ ...f, barIdx: 180, variant, nowMs: f.snapshot.nowMs });
describe("frozen local-confirmed entries", () => {
    it("uses a local structural stop without OI and remains unavailable to production selection", () => {
        const signal = decision();
        expect(signal).not.toBeNull();
        expect(signal!.invalidationPrice).toBeCloseTo(99.8 * .999);
        expect(signal!.metadata.executionRiskVersion).toBe(LOCAL_ENTRY_RISK.version);
        expect(() => getVariantById(variant.id)).toThrow("Unknown variant");
    });
    it("ignores future local bars and rejects incomplete, stale, missing or unconfirmed local evidence", () => {
        const f = fixture(), expected = decision(f);
        for (const row of f.panel.executionBarsTRY.slice(180)) row.close = row.high = 99999;
        expect(decision(f)).toEqual(expected);
        f.panel.executionBarsTRY[170].closeTime += 1;
        expect(decision(f)).toBeNull();
        const missing = fixture(); missing.panel.executionBarsTRY = []; expect(decision(missing)).toBeNull();
        const future = fixture(); future.snapshot.nowMs -= 1; expect(decision(future)).toBeNull();
        const noBreakout = fixture(); for (const b of noBreakout.panel.executionBarsTRY.slice(0, 120)) b.high = 102;
        expect(decision(noBreakout)).toBeNull();
    });
    it("refuses expensive or unsupported execution and BTC shock conditions", () => {
        const f = fixture(); f.snapshot.executionEstimate = { feePerSidePct: 5, slippageBpsPerSide: 100 };
        expect(decision(f)).toBeNull();
        f.snapshot.executionEstimate = undefined; expect(decision(f)).toBeNull();
        const shock = fixture(); shock.snapshot.btcExternalReturn4hPct = -2; expect(decision(shock)).toBeNull();
    });
    it("includes both fees and modeled stop slippage in risk sizing, rejects chasing and stale fills", () => {
        const intent = decision()!, args = { intent, mark: 101, nowMs: intent.availableAtMs + M, maxNotionalTry: 1000, riskBudgetTry: 5, feePerSidePct: .15, slippageBpsPerSide: 7 };
        const plan = planLocalEntry(args)!;
        expect(plan.modeledStopRiskTry).toBeLessThanOrEqual(5);
        const atStop = plan.quantity * intent.invalidationPrice! * (1 - .0007) * (1 - .0015);
        expect(plan.notionalTry + plan.feeTry - atStop).toBeCloseTo(plan.modeledStopRiskTry, 8);
        expect(planLocalEntry({ ...args, mark: 102 })).toBeNull();
        expect(planLocalEntry({ ...args, mark: 99 })).toBeNull();
        expect(planLocalEntry({ ...args, nowMs: intent.availableAtMs + 120001 })).toBeNull();
        expect(roundTripCostPct(.15, 7)).toBeGreaterThan(.44);
    });
    it("cancels a gapped pending order in replay and executes the unchanged price with scoped PR04 state", () => {
        const f = fixture();
        const replay = () => runTrySpotReplayUniverse({ panels: [f.panel], btcPanel: f.panel, variant, periodStart: 180 * H, periodEnd: 182 * H - 1, freshPartialStart: 200 * H });
        expect(replay().openPositions).toHaveLength(1);
        for (const b of f.panel.executionBarsTRY.slice(180)) b.open = b.close = b.high = b.low = 102;
        const cancelled = replay();
        expect(cancelled.openPositions).toHaveLength(0);
        expect(cancelled.portfolio.riskRejectedEntries).toBe(1);
        expect(cancelled.portfolio.cashTry).toBe(10000);
    });
});
