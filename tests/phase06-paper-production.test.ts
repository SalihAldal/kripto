import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { simulateRealisticFill } from "@/src/server/paper-runtime/fill-model";
import { applySymbolFilters, DEFAULT_USDT_FILTERS } from "@/src/server/paper-runtime/filters";
import { assertLiveOrderSubmissionAllowed, LIVE_ACK_PHRASE } from "@/src/server/paper-runtime/live-lock";
import { PaperRuntimeEngine, resetPaperRuntimeForTests } from "@/src/server/paper-runtime/paper-engine";
import { PaperExecutionAdapter, BinanceLiveExecutionAdapter, resolveExecutionAdapter } from "@/src/server/paper-runtime/execution-port";
import { SERVICE_RUNTIME_CLASS, PRODUCTION_FORBIDDEN_HOT_PATH_MODULES, isProductionHotPathForbidden } from "@/src/server/hot-path/canonical-pipeline";
import { claimCanonicalExecutionAttempt, resetCanonicalExecutionAttemptsForTests } from "@/src/server/hot-path/execution-attempt-lock.service";
import type { PaperIntent } from "@/src/server/paper-runtime/types";

const T0 = 1_700_000_000_000;

function levels(price: number, qty: number) {
  return [
    { price, quantity: qty },
    { price: price * 1.001, quantity: qty },
  ];
}

function market(symbol: string, last: number, bid: number, ask: number, qty = 10_000, t = T0) {
  return {
    symbol,
    last,
    bids: [
      { price: bid, quantity: qty },
      { price: bid * 0.999, quantity: qty },
    ],
    asks: levels(ask, qty),
    eventTime: t,
  };
}

function intent(extra: Partial<PaperIntent> = {}): PaperIntent {
  return {
    intentId: extra.intentId ?? "i1",
    candidateId: extra.candidateId ?? "AAAUSDT:1",
    symbol: extra.symbol ?? "AAAUSDT",
    side: "BUY",
    orderType: "MARKET",
    quantity: extra.quantity ?? 10,
    signalPrice: extra.signalPrice ?? 100,
    signalAt: extra.signalAt ?? T0,
    lane: extra.lane ?? "EARLY",
    score: extra.score ?? 88,
    stopPct: extra.stopPct ?? 2,
    takeProfitPct: extra.takeProfitPct ?? 4,
    ...extra,
  };
}

describe("phase 06 paper production readiness", () => {
  afterEach(() => {
    resetPaperRuntimeForTests();
    resetCanonicalExecutionAttemptsForTests();
    delete process.env.LIVE_TRADING_ENABLED;
    delete process.env.LIVE_TRADING_ACK;
    process.env.EXECUTION_MODE = "dry-run";
  });

  it("1 fee is applied on both sides", () => {
    const engine = new PaperRuntimeEngine({ takerFeeRate: 0.001, startEquity: 10_000, maxPositionNotional: 5_000, maxGrossExposurePercent: 80 });
    const open = engine.submit(intent({ quantity: 10, signalPrice: 100 }), market("AAAUSDT", 100, 99.9, 100.1), T0);
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    expect(open.fill.fee).toBeGreaterThan(0);
    engine.tick(market("AAAUSDT", 105, 104.9, 105.1, 10_000, T0 + 1_000), T0 + 60_000);
    const closed = engine.getClosed()[0];
    expect(closed.fees).toBeGreaterThan(open.fill.fee);
  });

  it("2 spread uses ask for BUY not lastPrice", () => {
    const fill = simulateRealisticFill({
      side: "BUY",
      quantity: 1,
      signalPrice: 100,
      bids: [{ price: 99.8, quantity: 10 }],
      asks: [{ price: 100.4, quantity: 10 }],
      feeRate: 0.001,
    });
    expect(fill.avgPrice).toBe(100.4);
    expect(fill.avgPrice).not.toBe(100);
  });

  it("3 slippage is size-aware via book walk", () => {
    const thin = simulateRealisticFill({
      side: "BUY",
      quantity: 8,
      signalPrice: 100,
      bids: [{ price: 99.9, quantity: 50 }],
      asks: [
        { price: 100.1, quantity: 1 },
        { price: 100.8, quantity: 20 },
      ],
      feeRate: 0.001,
    });
    expect(thin.avgPrice).toBeGreaterThan(100.1);
    expect(thin.slippagePct).toBeGreaterThan(0);
  });

  it("4-5 partial fill opens only filled quantity", () => {
    const engine = new PaperRuntimeEngine({ startEquity: 10_000, maxPositionNotional: 5_000, maxGrossExposurePercent: 80, takerFeeRate: 0.001 });
    const result = engine.submit(
      intent({ quantity: 10 }),
      { symbol: "AAAUSDT", last: 100, bids: [{ price: 99.9, quantity: 50 }], asks: [{ price: 100.1, quantity: 4 }], eventTime: T0 },
      T0,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fill.status).toBe("PARTIALLY_FILLED");
    expect(result.position.qty).toBe(4);
    expect(result.fill.remainingQty).toBe(6);
  });

  it("6 exchange filters reject below min notional", () => {
    const filtered = applySymbolFilters({ quantity: 0.001, price: 1, filters: { ...DEFAULT_USDT_FILTERS, minNotional: 10 } });
    expect(filtered.ok).toBe(false);
    expect(filtered.reasons).toContain("MIN_NOTIONAL");
  });

  it("7 latency fill uses execution-time book not signal price", () => {
    const fill = simulateRealisticFill({
      side: "BUY",
      quantity: 1,
      signalPrice: 100,
      latencyMs: 400,
      bids: [{ price: 100.8, quantity: 5 }],
      asks: [{ price: 101.2, quantity: 5 }],
      feeRate: 0.001,
    });
    expect(fill.avgPrice).toBe(101.2);
    expect(fill.latencyMs).toBe(400);
  });

  it("8 duplicate order is rejected", () => {
    const engine = new PaperRuntimeEngine({ startEquity: 10_000, maxPositionNotional: 5_000, maxGrossExposurePercent: 80 });
    const m = market("AAAUSDT", 100, 99.9, 100.1);
    expect(engine.submit(intent(), m, T0).ok).toBe(true);
    const dup = engine.submit(intent({ intentId: "i2" }), m, T0);
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.reason).toBe("REJECT_DUPLICATE_EXECUTION");
  });

  it("9 unknown order state does not retry", () => {
    const engine = new PaperRuntimeEngine();
    engine.markUnknown("lost-1");
    const result = engine.submit(intent({ intentId: "lost-1" }), market("AAAUSDT", 100, 99.9, 100.1), T0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("UNKNOWN_ORDER_STATE");
  });

  it("10 daily loss cap blocks new entries not exits", () => {
    const engine = new PaperRuntimeEngine({
      startEquity: 1_000,
      maxDailyLossPercent: 1,
      maxPositionNotional: 200,
      maxGrossExposurePercent: 80,
      takerFeeRate: 0,
      timeExitMs: 999_999_999,
    });
    const open = engine.submit(intent({ quantity: 2, stopPct: 5, takeProfitPct: 80 }), market("AAAUSDT", 100, 99.9, 100.1), T0);
    expect(open.ok).toBe(true);
    engine.tick(market("AAAUSDT", 80, 80, 80.1, 10_000, T0 + 2_000), T0 + 3_000);
    expect(engine.getClosed().length).toBe(1);
    const next = engine.submit(intent({ intentId: "i9", candidateId: "BBB:1", symbol: "BBBUSDT" }), market("BBBUSDT", 100, 99.9, 100.1), T0 + 4_000);
    expect(next.ok).toBe(false);
    if (next.ok) return;
    expect(next.reason).toBe("DAILY_LOSS");
  });

  it("11-12 max exposure and max positions work", () => {
    const engine = new PaperRuntimeEngine({
      startEquity: 1_000,
      maxOpenPositions: 1,
      maxGrossExposurePercent: 25,
      maxPositionNotional: 80,
      takerFeeRate: 0,
    });
    expect(engine.submit(intent({ quantity: 0.5 }), market("AAAUSDT", 100, 99.9, 100.1), T0).ok).toBe(true);
    const second = engine.submit(intent({ intentId: "i2", candidateId: "BBB:1", symbol: "BBBUSDT", quantity: 0.5 }), market("BBBUSDT", 100, 99.9, 100.1), T0);
    expect(second.ok).toBe(false);
  });

  it("13 drawdown protection blocks entries", () => {
    const engine = new PaperRuntimeEngine({
      startEquity: 1_000,
      maxDrawdownPercent: 1,
      maxDailyLossPercent: 90,
      maxPositionNotional: 400,
      maxGrossExposurePercent: 80,
      takerFeeRate: 0,
      timeExitMs: 9e8,
    });
    engine.submit(intent({ quantity: 3, stopPct: 5, takeProfitPct: 90 }), market("AAAUSDT", 100, 99.9, 100.1), T0);
    engine.tick(market("AAAUSDT", 90, 90, 90.2, 10_000, T0 + 1_000), T0 + 2_000);
    const next = engine.submit(intent({ intentId: "i2", candidateId: "CCC:1", symbol: "CCCUSDT" }), market("CCCUSDT", 100, 99.9, 100.1), T0 + 3_000);
    expect(next.ok).toBe(false);
    if (next.ok) return;
    expect(["DRAWDOWN", "DAILY_LOSS"]).toContain(next.reason);
  });

  it("14 BTC shock blocks new longs", () => {
    const engine = new PaperRuntimeEngine({ btcShockPct: -1, startEquity: 5_000, maxPositionNotional: 200 });
    engine.setHealth({ btcReturn1m: -2 });
    const result = engine.submit(intent(), market("AAAUSDT", 100, 99.9, 100.1), T0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("BTC_SHOCK");
  });

  it("15 stale data blocks entry", () => {
    const engine = new PaperRuntimeEngine({ staleDataMaxAgeMs: 1_000 });
    engine.setHealth({ dataAgeMs: 20_000 });
    expect(engine.submit(intent(), market("AAAUSDT", 100, 99.9, 100.1), T0).ok).toBe(false);
  });

  it("16 WS failure blocks entry", () => {
    const engine = new PaperRuntimeEngine();
    engine.setHealth({ wsStatus: "FAILED" });
    expect(engine.submit(intent(), market("AAAUSDT", 100, 99.9, 100.1), T0).ok).toBe(false);
  });

  it("17-18 Redis and DB fail-safe block new entries", () => {
    const engine = new PaperRuntimeEngine();
    engine.setHealth({ redisOk: false });
    expect(engine.submit(intent(), market("AAAUSDT", 100, 99.9, 100.1), T0).ok).toBe(false);
    engine.setHealth({ redisOk: true, dbOk: false });
    expect(engine.submit(intent({ intentId: "i2", candidateId: "X:1" }), market("AAAUSDT", 100, 99.9, 100.1), T0).ok).toBe(false);
  });

  it("19 risk reject is machine-readable", () => {
    const engine = new PaperRuntimeEngine();
    engine.setHealth({ wsStatus: "DEGRADED" });
    const result = engine.submit(intent(), market("AAAUSDT", 100, 99.9, 100.1), T0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/^[A-Z0-9_]+$/);
  });

  it("20 stop executes on bid with gap, not exact stop price", () => {
    const engine = new PaperRuntimeEngine({ startEquity: 10_000, maxPositionNotional: 5_000, maxGrossExposurePercent: 80, takerFeeRate: 0, timeExitMs: 9e8 });
    engine.submit(intent({ quantity: 1, stopPct: 2, takeProfitPct: 50 }), market("AAAUSDT", 100, 99.9, 100.1), T0);
    engine.tick(market("AAAUSDT", 90, 90, 90.2, 10_000, T0 + 500), T0 + 1_000);
    const closed = engine.getClosed()[0];
    expect(closed.reason).toBe("HARD_STOP");
    expect(closed.exit).toBe(90);
    expect(closed.exit).not.toBe(98);
  });

  it("21 partial TP reduces quantity", () => {
    const engine = new PaperRuntimeEngine({
      startEquity: 10_000,
      maxPositionNotional: 5_000,
      maxGrossExposurePercent: 80,
      takerFeeRate: 0,
      partialTpPct: 1,
      partialTpFraction: 0.5,
      timeExitMs: 9e8,
      trailPct: 50,
    });
    engine.submit(intent({ quantity: 10, stopPct: 20, takeProfitPct: 8 }), market("AAAUSDT", 100, 99.9, 100.1), T0);
    engine.tick(market("AAAUSDT", 101.5, 101.5, 101.6, 10_000, T0 + 1_000), T0 + 2_000);
    expect(engine.getOpen()[0]?.qty).toBeLessThan(10);
    expect(engine.getClosed().length).toBe(1);
  });

  it("22 trailing stop follows high-water mark", () => {
    const engine = new PaperRuntimeEngine({
      startEquity: 10_000,
      maxPositionNotional: 5_000,
      maxGrossExposurePercent: 80,
      takerFeeRate: 0,
      trailPct: 1,
      timeExitMs: 9e8,
      partialTpPct: 90,
    });
    engine.submit(intent({ quantity: 1, stopPct: 20, takeProfitPct: 50 }), market("AAAUSDT", 100, 99.9, 100.1), T0);
    engine.tick(market("AAAUSDT", 110, 110, 110.1, 10_000, T0 + 1_000), T0 + 2_000);
    engine.tick(market("AAAUSDT", 108.5, 108.5, 108.6, 10_000, T0 + 3_000), T0 + 4_000);
    expect(engine.getClosed()[0]?.reason).toBe("TRAILING");
  });

  it("23 time exit fires without progress", () => {
    const engine = new PaperRuntimeEngine({
      startEquity: 10_000,
      maxPositionNotional: 5_000,
      maxGrossExposurePercent: 80,
      takerFeeRate: 0,
      timeExitMs: 5_000,
      minProgressPct: 2,
      trailPct: 80,
      partialTpPct: 90,
    });
    engine.submit(intent({ quantity: 1, stopPct: 20, takeProfitPct: 50 }), market("AAAUSDT", 100, 99.9, 100.1), T0);
    engine.tick(market("AAAUSDT", 100.2, 100.2, 100.3, 10_000, T0 + 6_000), T0 + 6_000);
    expect(engine.getClosed()[0]?.reason).toBe("TIME_EXIT");
  });

  it("24 exit race produces one close", () => {
    const engine = new PaperRuntimeEngine({ startEquity: 10_000, maxPositionNotional: 5_000, maxGrossExposurePercent: 80, takerFeeRate: 0, timeExitMs: 1, minProgressPct: 50 });
    engine.submit(intent({ quantity: 1, stopPct: 1, takeProfitPct: 0.5 }), market("AAAUSDT", 100, 99.9, 100.1), T0);
    engine.tick(market("AAAUSDT", 90, 90, 90.1, 10_000, T0 + 2_000), T0 + 2_000);
    expect(engine.getClosed().length).toBe(1);
    expect(engine.getOpen().length).toBe(0);
  });

  it("25 restart restores positions without duplicate", () => {
    const engine = new PaperRuntimeEngine({ startEquity: 10_000, maxPositionNotional: 5_000, maxGrossExposurePercent: 80 });
    engine.submit(intent(), market("AAAUSDT", 100, 99.9, 100.1), T0);
    const snap = engine.snapshot();
    const restored = new PaperRuntimeEngine({ startEquity: 10_000, maxPositionNotional: 5_000, maxGrossExposurePercent: 80 });
    restored.restore(snap);
    expect(restored.getOpen().length).toBe(1);
    const dup = restored.submit(intent({ intentId: "new" }), market("AAAUSDT", 100, 99.9, 100.1), T0 + 1);
    expect(dup.ok).toBe(false);
  });

  it("26-27 equity/PnL includes fees and slippage", () => {
    const engine = new PaperRuntimeEngine({ startEquity: 2_500, maxPositionNotional: 500, maxGrossExposurePercent: 50, takerFeeRate: 0.001 });
    engine.submit(intent({ quantity: 1, stopPct: 20, takeProfitPct: 2 }), market("AAAUSDT", 100, 99.9, 100.2), T0);
    engine.tick(market("AAAUSDT", 105, 105, 105.1, 10_000, T0 + 1_000), T0 + 2_000);
    const perf = engine.performance();
    const trade = engine.getClosed()[0];
    expect(perf.feesPaid).toBeGreaterThan(0);
    expect(trade.net).toBeLessThan(trade.gross);
    expect(perf.sample).toBe("INSUFFICIENT_SAMPLE");
  });

  it("28 paper adapter cannot reach live order endpoints", () => {
    const adapter = new PaperExecutionAdapter();
    expect(() => adapter.submitLiveBinanceOrder()).toThrow(/NO_LIVE_ENDPOINT/);
    expect(resolveExecutionAdapter("paper").kind).toBe("PAPER");
    expect(() => new BinanceLiveExecutionAdapter().submit()).toThrow(/HARD_LOCKED/);
    const dir = path.join(process.cwd(), "src/server/paper-runtime");
    for (const file of ["paper-engine.ts", "fill-model.ts", "execution-port.ts"]) {
      const src = readFileSync(path.join(dir, file), "utf8");
      expect(src).not.toMatch(/placeMarketBuy|placeMarketSell|placeMarketBuyByQuote/);
    }
  });

  it("29 live mode accidental activation is locked", () => {
    process.env.EXECUTION_MODE = "live";
    process.env.LIVE_TRADING_ENABLED = "false";
    process.env.LIVE_TRADING_ACK = "";
    const locked = assertLiveOrderSubmissionAllowed({ executionMode: "live" });
    expect(locked.allowed).toBe(false);
    expect(locked.reasons).toContain("LIVE_ACK_MISSING");
    process.env.LIVE_TRADING_ENABLED = "true";
    process.env.LIVE_TRADING_ACK = LIVE_ACK_PHRASE;
    const open = assertLiveOrderSubmissionAllowed({ executionMode: "live" });
    expect(open.allowed).toBe(true);
    const dry = assertLiveOrderSubmissionAllowed({ executionMode: "paper" });
    expect(dry.allowed).toBe(false);
  });

  it("30 legacy path cannot enter production execution", () => {
    expect(SERVICE_RUNTIME_CLASS["decision-engine"]).toBe("LEGACY");
    expect(SERVICE_RUNTIME_CLASS["paper-runtime"]).toBe("CANONICAL");
    expect(SERVICE_RUNTIME_CLASS["binance-live-execution-adapter"]).toBe("DISABLED");
    expect(isProductionHotPathForbidden("src/server/decision-engine-v2/foo.ts")).toBe(true);
    expect(PRODUCTION_FORBIDDEN_HOT_PATH_MODULES.some((row) => row.includes("decision-engine-v2"))).toBe(true);
    const a = claimCanonicalExecutionAttempt({ candidateId: "Z:1", executionId: "e1" });
    const b = claimCanonicalExecutionAttempt({ candidateId: "Z:1", executionId: "e2" });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
  });

  it("429/418 and lookahead and SELL-on-bid", () => {
    const engine = new PaperRuntimeEngine();
    engine.setHealth({ rateLimit429: true });
    expect(engine.submit(intent(), market("AAAUSDT", 100, 99.9, 100.1), T0).ok).toBe(false);
    engine.setHealth({ rateLimit429: false, ipBan418: true });
    expect(engine.submit(intent({ intentId: "i2", candidateId: "Y:1" }), market("AAAUSDT", 100, 99.9, 100.1), T0).ok).toBe(false);
    const late = engine.submit(intent({ intentId: "i3", candidateId: "L:1" }), { ...market("AAAUSDT", 100, 99.9, 100.1), eventTime: T0 + 5_000 }, T0);
    expect(late.ok).toBe(false);
    const sell = simulateRealisticFill({
      side: "SELL",
      quantity: 1,
      signalPrice: 100,
      bids: [{ price: 99.5, quantity: 3 }],
      asks: [{ price: 100.5, quantity: 3 }],
      feeRate: 0.001,
    });
    expect(sell.avgPrice).toBe(99.5);
  });
});
