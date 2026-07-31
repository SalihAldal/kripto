import { describe, expect, it } from "vitest";
import { LivePaperEngine } from "@/src/server/trading-core/paper/live-paper-engine";

describe("live paper trading engine", () => {
  it("fake balance yetersizse order reject eder", async () => {
    const engine = new LivePaperEngine({ initialBalances: { USDT: 10 }, mode: "test" });
    await expect(
      engine.openOrder({
        symbol: "BTCUSDT",
        side: "BUY",
        quantity: 1,
        markPrice: 1000,
        leverage: 1,
        idempotencyKey: "poor-balance",
      }),
    ).rejects.toThrow(/Paper bakiye yetersiz/i);
  });

  it("BUY paper order fake balance dusurur ve position acar", async () => {
    const engine = new LivePaperEngine({ initialBalances: { USDT: 5000 }, mode: "test" });
    const fill = await engine.openOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: 1,
      markPrice: 1000,
      leverage: 1,
      idempotencyKey: "buy-1",
    });
    const status = engine.status();
    expect(fill.status).toBe("FILLED");
    expect(status.positions).toHaveLength(1);
    expect(status.account.balances.USDT).toBeLessThan(5000);
  });

  it("slippage price'i beklenen yonde degistirir ve fee hesaplar", async () => {
    const engine = new LivePaperEngine({
      initialBalances: { USDT: 5000 },
      mode: "test",
      slippageBps: 10,
      takerFeeRate: 0.001,
    });
    const fill = await engine.openOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: 1,
      markPrice: 1000,
      leverage: 1,
      idempotencyKey: "slippage-fee",
    });
    expect(fill.price).toBeCloseTo(1001, 6);
    expect(fill.fee).toBeCloseTo(1.001, 6);
  });

  it("leverage margin ihtiyacini dusurur ama notional exposure'i korur", async () => {
    const engine = new LivePaperEngine({ initialBalances: { USDT: 500 }, mode: "test" });
    const fill = await engine.openOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: 1,
      markPrice: 1000,
      leverage: 5,
      slippageBps: 0,
      idempotencyKey: "lev-1",
    });
    expect(fill.notional).toBeCloseTo(1000, 6);
    expect(fill.margin).toBeCloseTo(200, 6);
    expect(engine.status().account.balances.USDT).toBeGreaterThan(250);
  });

  it("tick TP'ye ulasirsa position otomatik kapanir", async () => {
    const engine = new LivePaperEngine({ initialBalances: { USDT: 5000 }, mode: "test" });
    await engine.openOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: 1,
      markPrice: 1000,
      leverage: 1,
      takeProfitPercent: 1,
      stopLossPercent: 1,
      idempotencyKey: "tp-1",
    });
    const updates = engine.ingestTick({ symbol: "BTCUSDT", price: 1012, eventTime: Date.now() });
    expect(updates[0]?.closed?.reason).toBe("TAKE_PROFIT");
    expect(engine.status().positions).toHaveLength(0);
  });

  it("tick SL'ye ulasirsa position otomatik kapanir", async () => {
    const engine = new LivePaperEngine({ initialBalances: { USDT: 5000 }, mode: "test" });
    await engine.openOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: 1,
      markPrice: 1000,
      leverage: 1,
      takeProfitPercent: 1,
      stopLossPercent: 1,
      idempotencyKey: "sl-1",
    });
    const updates = engine.ingestTick({ symbol: "BTCUSDT", price: 988, eventTime: Date.now() });
    expect(updates[0]?.closed?.reason).toBe("STOP_LOSS");
    expect(engine.status().positions).toHaveLength(0);
  });

  it("ayni idempotency key ikinci kez order acmaz", async () => {
    const engine = new LivePaperEngine({ initialBalances: { USDT: 5000 }, mode: "test" });
    const first = await engine.openOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: 1,
      markPrice: 1000,
      leverage: 1,
      idempotencyKey: "same-key",
    });
    const second = await engine.openOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: 1,
      markPrice: 1000,
      leverage: 1,
      idempotencyKey: "same-key",
    });
    expect(second.positionId).toBe(first.positionId);
    expect(engine.status().positions).toHaveLength(1);
  });

  it("test modu gercek WS baslatmadan manuel tick ile calisir", async () => {
    const engine = new LivePaperEngine({ initialBalances: { USDT: 5000 }, mode: "test" });
    await engine.start();
    expect(engine.status().stream.running).toBe(false);
    engine.ingestTick({ symbol: "BTCUSDT", price: 1000, eventTime: Date.now() });
    expect(engine.status().lastTick?.symbol).toBe("BTCUSDT");
  });

  it("1000 simulated trade boyunca pozisyon sizdirmaz ve balance stabil kalir", async () => {
    const engine = new LivePaperEngine({
      initialBalances: { USDT: 1_000_000 },
      mode: "test",
      slippageBps: 1,
      takerFeeRate: 0.0004,
    });
    let closedCount = 0;

    for (let index = 0; index < 1000; index += 1) {
      const side = index % 2 === 0 ? "BUY" : "SELL";
      await engine.openOrder({
        symbol: "BTCUSDT",
        side,
        quantity: 0.01,
        markPrice: 1000,
        leverage: 1,
        takeProfitPercent: 0.2,
        stopLossPercent: 0.2,
        idempotencyKey: `stress-${index}`,
      });
      const closePrice = side === "BUY" ? 1003 : 997;
      const updates = engine.ingestTick({ symbol: "BTCUSDT", price: closePrice, eventTime: index });
      closedCount += updates.filter((update) => update.closed).length;
    }

    const status = engine.status();
    expect(closedCount).toBe(1000);
    expect(status.positions).toHaveLength(0);
    expect(status.account.balances.USDT).toBeGreaterThan(999_000);
  });
});
