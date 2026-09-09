import { describe, it, expect } from "vitest";
import { runTrySpotReplayUniverse } from "@/src/server/alpha-engine-v2/try-spot-replay.service";
import { STRATEGY_VARIANTS } from "@/src/server/trade-decision-core/entry-signal.service";
import { summarizeWindow } from "@/src/server/trade-decision-core/window-diagnostics.service";
import { buildOiFeatures, prepareOiFeatureCache } from "@/src/server/alpha-engine-v2/oi-features.service";
import { evaluateUnifiedEntryDecision } from "@/src/server/trade-decision-core/trade-decision-core.service";
import { applyTradeDecisionCoreProductionBridge } from "@/src/server/trade-decision-core/production-bridge.service";
import type { TrySpotPanel } from "@/src/server/trade-decision-core/try-dataset-loader.service";
const H = 3600000;
function panel(symbol = "BTC", price = 100): TrySpotPanel {
    const bars = Array.from({ length: 80 }, (_, i) => ({ openTime: i * H, closeTime: (i + 1) * H - 1, open: 100, high: 112, low: 99, close: i === 48 ? 110 : 100, volume: 1000, quoteVolume: 100000, takerBuyQuote: 50000 }));
    return { symbol: `${symbol}USDT`, baseAsset: symbol, executionSymbol: `${symbol}TRY`, venue: "FUTURES", bars,
        openInterest: bars.map((b, i) => ({ timestamp: b.closeTime, openInterest: i === 48 ? 102000 : 100000 })),
        funding: [{ fundingTime: 0, fundingRate: 0 }], basis: [], liquidations: [], aggTrades: [], cvd: [], longShortRatio: [], orderBook: [], provenance: [],
        availability: { OHLCV: "AVAILABLE", FUNDING: "AVAILABLE", BASIS: "UNAVAILABLE", OPEN_INTEREST: "AVAILABLE", LIQUIDATION: "UNAVAILABLE", AGG_TRADES: "UNAVAILABLE", CVD: "UNAVAILABLE", LONG_SHORT_RATIO: "UNAVAILABLE", ORDER_BOOK: "UNAVAILABLE" },
        executionBarsTRY: Array.from({ length: 80 * 60 }, (_, i) => ({ openTime: i * 60000, closeTime: (i + 1) * 60000 - 1, open: price, high: price, low: price, close: price, volume: 10000, quoteVolume: 1000000, takerBuyQuote: 500000 })) };
}
function run(p = panel(), extra: Partial<Parameters<typeof runTrySpotReplayUniverse>[0]> = {}) {
    return runTrySpotReplayUniverse({ panels: [p], btcPanel: p, variant: STRATEGY_VARIANTS[0], periodStart: 0, periodEnd: 80 * H - 1, freshPartialStart: 75 * H, ...extra });
}
describe("causal TRY portfolio replay", () => {
    it("rejects infinite cash, infinite budgets and fractional position limits", () => {
        for (const config of [{ initialCashTry: Infinity }, { notionalTry: Infinity }, { maxPositions: 1.5 }])
            expect(() => run(panel(), config)).toThrow("INVALID_REPLAY_CONFIG");
    });
    it("attributes identical closed fills exactly and reports open PnL separately", () => {
        const p = panel();
        for (const b of p.executionBarsTRY) if (b.openTime >= 51 * H) b.open = b.high = b.low = b.close = 105;
        const r = run(p), s = summarizeWindow(r, 0, 80 * H - 1), t = r.trades[0];
        expect(s.closedTradeCosts.rawGrossPnlTry).toBeCloseTo(t.quantity * 5, 8);
        expect(s.closedTradeCosts.rawGrossPnlTry - s.closedTradeCosts.modeledSlippageTry - s.closedTradeCosts.feesTry).toBeCloseTo(t.netPnlTry, 8);
        expect(s.profitFactor).toBeNull();
        expect(s.profitFactorStatus).toBe("NO_LOSING_TRADES");
        expect(s.paperEligible).toBeNull();
        const openRun = run(p, { periodEnd: 52 * H - 1 });
        const open = summarizeWindow(openRun, 0, 52 * H - 1);
        expect(open.closedTradeCosts.netPnlTry).toBe(0);
        expect(open.unfinishedPositionPnlTry).toBeCloseTo(openRun.portfolio.netPnlTry, 8);
    });
    it("charges slippage once, accounts entry and exit fees, conserves cash", () => {
        const r = run();
        expect(r.trades).toHaveLength(1);
        const t = r.trades[0];
        expect(t.grossReturnPct).toBeCloseTo(0, 10);
        expect(t.netReturnPct).toBeCloseTo(-.4396922, 5);
        expect(t.entryAtMs).toBeGreaterThan(t.signalAtMs);
        expect(t.exitAtMs).toBeGreaterThan(t.entryAtMs + 8 * H);
        expect(r.portfolio.cashTry).toBeCloseTo(10000 + t.netPnlTry, 8);
        expect(r.openPositions).toHaveLength(0);
    });
    it("keeps an unfillable exit open instead of deleting the trade", () => {
        const p = panel();
        for (const b of p.executionBarsTRY)
            if (b.openTime >= 57 * H) {
                b.volume = 0;
                b.quoteVolume = 0;
            }
        const r = run(p);
        expect(r.trades).toHaveLength(0);
        expect(r.openPositions).toHaveLength(1);
        expect(r.openPositions[0].exitPending).toBe(true);
        expect(r.portfolio.cashTry).toBeLessThan(10000);
    });
    it("partially fills exits according to volume and reconciles proceeds", () => {
        const p = panel();
        for (const b of p.executionBarsTRY)
            if (b.openTime >= 57 * H)
                b.quoteVolume = 10000;
        const r = run(p);
        expect(r.trades).toHaveLength(1);
        expect(r.trades[0].exitFillCount).toBeGreaterThan(1);
        expect(r.portfolio.cashTry).toBeCloseTo(10000 + r.trades[0].netPnlTry, 7);
    });
    it("is independent of input symbol order and reserves shared cash", () => {
        const a = panel(), b = panel("ETH");
        const x = run(a, { panels: [a, b], initialCashTry: 1100 });
        const y = run(a, { panels: [b, a], initialCashTry: 1100 });
        expect(x.trades).toEqual(y.trades);
        expect(x.trades).toHaveLength(1);
        expect(x.portfolio.rejectedCash).toBeGreaterThan(0);
        expect(x.portfolio.cashTry).toBeGreaterThanOrEqual(0);
    });
    it("marks open losses in drawdown even when there is no completed trade", () => {
        const p = panel();
        for (const b of p.executionBarsTRY)
            if (b.openTime >= 50 * H) {
                b.open = b.high = b.low = b.close = 50;
                b.quoteVolume = 0;
                b.volume = 0;
            }
        // One traded mark followed by an illiquid period, with the position still open.
        const b = p.executionBarsTRY[50 * 60];
        b.volume = 1000;
        b.quoteVolume = 50000;
        const r = run(p, { periodEnd: 52 * H - 1 });
        expect(r.openPositions).toHaveLength(1);
        expect(r.stats.maxDrawdown).toBeGreaterThan(5);
        expect(r.trades).toHaveLength(0);
    });
    it("maps invalidation by ratio to TRY and rejects future bars", () => {
        const p = panel("BTC", 4000), i = 48;
        const snapshot = { nowMs: p.bars[i].closeTime, baseAsset: "BTC", externalSymbol: p.symbol, executionSymbol: p.executionSymbol, externalBarIdx: i, externalClose: 110, tryBarIdx: 2939, tryPrice: 4000, tryVolume: 10, tryAvailableAtMs: p.bars[i].closeTime, btcExternalReturn4hPct: 0 };
        const signal = evaluateUnifiedEntryDecision({ variant: STRATEGY_VARIANTS[0], panel: p, barIdx: i, snapshot, nowMs: snapshot.nowMs });
        expect(signal?.invalidationPrice).toBeCloseTo(4000 * (99 * .985 / 110), 10);
        expect(signal?.invalidationCurrency).toBe("TRY");
        expect(evaluateUnifiedEntryDecision({ variant: STRATEGY_VARIANTS[0], panel: p, barIdx: i, snapshot: { ...snapshot, nowMs: 0 }, nowMs: 0 })).toBeNull();
    });
    it("PR04 exits reconcile partial fills without corrupting another replay", () => {
        const p = panel();
        for (const b of p.executionBarsTRY)
            if (b.openTime >= 51 * H)
                b.open = b.high = b.low = b.close = 80;
        const r = run(p, { variant: { ...STRATEGY_VARIANTS[0], exitMode: "pr04_trail" } });
        expect(r.trades).toHaveLength(1);
        expect(r.trades[0].exitReason).toBe("STRUCTURAL_STOP");
        expect(r.portfolio.cashTry).toBeCloseTo(10000 + r.trades[0].netPnlTry, 6);
        expect(run(p, { variant: { ...STRATEGY_VARIANTS[0], exitMode: "pr04_trail" } }).trades).toEqual(r.trades);
    });
    it("feature cache preserves original expanding reference and prefix causality", () => {
        const p = panel();
        for (let i = 0; i < 80; i++)
            p.openInterest[i].openInterest = 10000 + i * i + Math.sin(i) * 100;
        const before = p.bars.map((_, i) => buildOiFeatures(p, i));
        prepareOiFeatureCache(p);
        for (let i = 28; i < 80; i++) {
            const a = before[i]!, b = buildOiFeatures(p, i)!;
            expect(b.oiPercentile).toBe(a.oiPercentile);
            expect(b.oiZScore).toBeCloseTo(a.oiZScore, 10);
        }
        const prefix = { ...p, bars: p.bars.slice(0, 49), openInterest: p.openInterest.slice(0, 49) };
        prepareOiFeatureCache(prefix);
        expect(buildOiFeatures(prefix, 48)).toEqual(buildOiFeatures(p, 48));
    });
    it("production bridge refuses to substitute USDT price for missing TRY metadata", () => {
        const p = panel();
        const r = applyTradeDecisionCoreProductionBridge({ enabled: true, variantId: "baseline_fixed_8h_v1", candidateMetadata: { tradeDecisionCorePanel: p, externalBarIdx: 48 }, symbol: "BTCTRY", decisionAtMs: 49 * H - 1, p4SelectedSignal: null, p4PreferredStrategy: null, candidateId: "a", lifecycleId: "b", featureSnapshotId: "c", mode: "paper", fallbackIdempotencyKey: "x" });
        expect(r.entryIntent).toBeNull();
        expect(r.status).toBe("skipped_no_bar");
    });
});

it("production bridge emits the same TRY intent when real as-of metadata is present", () => {
  const p=panel();const at=p.bars[48].closeTime;
  const r=applyTradeDecisionCoreProductionBridge({enabled:true,variantId:"baseline_fixed_8h_v1",candidateMetadata:{tradeDecisionCorePanel:p,externalBarIdx:48,tryPrice:4000,tryVolume:1000,tryAvailableAtMs:at},symbol:"BTCTRY",decisionAtMs:at,p4SelectedSignal:null,p4PreferredStrategy:null,candidateId:"a",lifecycleId:"b",featureSnapshotId:"c",mode:"paper",fallbackIdempotencyKey:"x"});
  expect(r.status).toBe("overlay");expect(r.entryIntent?.invalidationCurrency).toBe("TRY");
  expect(r.selectedSignalOverlay?.invalidation?.invalidationThreshold).toBeCloseTo(4000*(99*.985/110),10);
});
