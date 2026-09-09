import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marketDataGateway } from "@/src/server/market-data/market-data-gateway";
import { MARKET_DATA_NOT_READY_CODE } from "@/src/server/market-data/market-data-unavailable.error";
import {
  BoundedRingBuffer,
} from "@/src/server/market-data/spine/ring-buffer";
import {
  computeSpread,
  normalizeAggTrade,
  normalizeBookTicker,
  normalizeMiniTicker,
} from "@/src/server/market-data/spine/payload-normalizer";
import { MemoryKv } from "@/src/server/market-data/spine/shared-kv";
import { DistributedRestLimiter } from "@/src/server/market-data/spine/distributed-rest-limiter";
import { RestSingleFlight } from "@/src/server/market-data/spine/rest-single-flight";
import { RedisMarketState } from "@/src/server/market-data/spine/redis-market-state";
import { OrderBookAssembler } from "@/src/server/market-data/spine/order-book-assembler";
import { filterTradeableUniverse } from "@/src/server/market-data/spine/universe";
import { FakeMarketSocket } from "@/src/server/market-data/spine/ws-connection";
import {
  MarketDataDaemon,
  resetMarketDataDaemonForTests,
} from "@/src/server/market-data/spine/market-data-daemon";
import {
  countHotPathPublicMarketRestCalls,
  resetPublicMarketRestAudit,
} from "@/src/server/market-data/spine/rest-call-audit";
import { LEGACY_WORKER_REGISTRY } from "@/src/server/hot-path/hot-path.registry";
import { CANONICAL_CRITICAL_WORKER_IDS } from "@/src/server/hot-path/worker-ownership.service";

const exchangeMocks = vi.hoisted(() => ({
  getTicker: vi.fn(),
  getKlines: vi.fn(),
  getOrderBook: vi.fn(),
  getRecentTrades: vi.fn(),
  getExchangeInfo: vi.fn(),
  listTickers24h: vi.fn(),
}));

vi.mock("@/src/server/exchange", () => ({
  getExchangeProvider: () => exchangeMocks,
}));

function miniTicker(symbol: string, price: number, extra?: Record<string, string | number>) {
  return {
    e: "24hrMiniTicker",
    E: Date.now(),
    s: symbol,
    c: String(price),
    o: String(price * 0.99),
    h: String(price * 1.02),
    l: String(price * 0.98),
    v: "1000",
    q: "2500000",
    ...extra,
  };
}

describe("phase 02 realtime market spine", () => {
  beforeEach(() => {
    resetPublicMarketRestAudit();
    resetMarketDataDaemonForTests();
    exchangeMocks.getTicker.mockReset();
    exchangeMocks.getKlines.mockReset();
    exchangeMocks.getOrderBook.mockReset();
    exchangeMocks.getRecentTrades.mockReset();
    exchangeMocks.getExchangeInfo.mockReset();
    exchangeMocks.listTickers24h.mockReset();
    exchangeMocks.getTicker.mockImplementation(() => {
      throw new Error("HOT_PATH_REST_FORBIDDEN:getTicker");
    });
    exchangeMocks.getKlines.mockImplementation(() => {
      throw new Error("HOT_PATH_REST_FORBIDDEN:getKlines");
    });
    exchangeMocks.getOrderBook.mockImplementation(() => {
      throw new Error("HOT_PATH_REST_FORBIDDEN:getOrderBook");
    });
    exchangeMocks.getRecentTrades.mockImplementation(() => {
      throw new Error("HOT_PATH_REST_FORBIDDEN:getRecentTrades");
    });
    exchangeMocks.listTickers24h.mockImplementation(() => {
      throw new Error("HOT_PATH_REST_FORBIDDEN:listTickers24h");
    });
  });

  afterEach(() => {
    resetMarketDataDaemonForTests().stop();
  });

  it("normalizes all-market miniTicker events", () => {
    const event = normalizeMiniTicker(miniTicker("BTCUSDT", 65000));
    expect(event?.symbol).toBe("BTCUSDT");
    expect(event?.price).toBe(65000);
    expect(event?.quoteVolume).toBe(2_500_000);
    expect(event?.source).toBe("binance-ws");
  });

  it("updates symbol state from ticker ingest", () => {
    const daemon = resetMarketDataDaemonForTests();
    daemon.ingest([miniTicker("ETHUSDT", 2400)]);
    const latest = daemon.getLatest("ETHUSDT");
    expect(latest?.lastPrice).toBe(2400);
    expect(latest?.quoteVolume24h).toBe(2_500_000);
  });

  it("marks stale symbols after freshness window", () => {
    const daemon = resetMarketDataDaemonForTests(new MarketDataDaemon({ autoConnect: false, kv: new MemoryKv() }));
    daemon.ingest([miniTicker("SOLUSDT", 140)], Date.now() - 20_000);
    expect(daemon.isFresh("SOLUSDT")).toBe(false);
    expect(daemon.getLatest("SOLUSDT")?.stale).toBe(true);
  });

  it("keeps ring buffer bounded", () => {
    const buffer = new BoundedRingBuffer(32);
    for (let i = 0; i < 200; i += 1) {
      buffer.push({ t: i, price: 100 + i, quoteVolume: i, baseVolume: i });
    }
    expect(buffer.size).toBe(32);
    expect(buffer.latest()?.price).toBe(299);
  });

  it("scanner market-state reads do not call the network", async () => {
    const daemon = resetMarketDataDaemonForTests();
    daemon.ingest([miniTicker("BTCUSDT", 100), miniTicker("ETHUSDT", 200)]);
    resetPublicMarketRestAudit();
    const ticker = await marketDataGateway.getTicker("BTCUSDT");
    const all = await marketDataGateway.listTickers24h();
    const bundle = await marketDataGateway.fetchContextBundle({ symbol: "BTCUSDT", lite: true });
    const snapshot = daemon.getMarketSnapshot();
    expect(ticker.price).toBe(100);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(bundle.ticker.symbol).toBe("BTCUSDT");
    expect(snapshot.length).toBeGreaterThanOrEqual(2);
    expect(countHotPathPublicMarketRestCalls()).toBe(0);
    expect(exchangeMocks.getTicker).not.toHaveBeenCalled();
    expect(exchangeMocks.listTickers24h).not.toHaveBeenCalled();
    expect(exchangeMocks.getKlines).not.toHaveBeenCalled();
    expect(exchangeMocks.getOrderBook).not.toHaveBeenCalled();
    expect(exchangeMocks.getRecentTrades).not.toHaveBeenCalled();
  });

  it("returns DATA_NOT_READY instead of REST fallback", async () => {
    resetMarketDataDaemonForTests();
    await expect(marketDataGateway.getTicker("MISSINGUSDT")).rejects.toMatchObject({
      code: MARKET_DATA_NOT_READY_CODE,
    });
    expect(exchangeMocks.getTicker).not.toHaveBeenCalled();
  });

  it("does not duplicate websocket subscriptions and restores after reconnect", async () => {
    const sockets: FakeMarketSocket[] = [];
    const factory = () => {
      const socket = new FakeMarketSocket();
      sockets.push(socket);
      queueMicrotask(() => socket.open());
      return socket;
    };
    const daemon = resetMarketDataDaemonForTests(
      new MarketDataDaemon({ autoConnect: false, kv: new MemoryKv(), socketFactory: factory }),
    );
    daemon.connectStreams();
    await Promise.resolve();
    const first = daemon.subscribeDeep("BTCUSDT", "early");
    const second = daemon.subscribeDeep("BTCUSDT", "momentum");
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(0);
    expect(daemon.subscriptions.refCount("BTCUSDT", "aggTrade")).toBe(2);
    daemon.flushCommandQueue();
    daemon.restoreDeepSubscriptions();
    daemon.flushCommandQueue();
    const sent = sockets.flatMap((socket) => socket.sent);
    const subscribePayloads = sent.filter((row) => row.includes("SUBSCRIBE") && row.includes("btcusdt@aggTrade"));
    expect(subscribePayloads.length).toBeGreaterThanOrEqual(1);
    const left = daemon.unsubscribeDeep("BTCUSDT", "early");
    expect(left.length).toBe(0);
    expect(daemon.subscriptions.refCount("BTCUSDT", "aggTrade")).toBe(1);
  });

  it("renews scanner leases without leaking owner references and flushes expiry", () => {
    const daemon = resetMarketDataDaemonForTests(new MarketDataDaemon({ autoConnect: false, kv: new MemoryKv() }));
    for (let i = 0; i < 50; i++) daemon.subscribeDeep("BTCUSDT", "scanner-context", ["aggTrade"]);
    expect(daemon.subscriptions.refCount("BTCUSDT", "aggTrade")).toBe(1);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120001);
    daemon.flushCommandQueue();
    expect(daemon.subscriptions.refCount("BTCUSDT", "aggTrade")).toBe(0);
    clock.mockRestore();
  });

  it("normalizes aggTrade taker direction", () => {
    const buy = normalizeAggTrade({ e: "aggTrade", s: "BTCUSDT", p: "100", q: "2", m: false, E: 1, T: 1 });
    const sell = normalizeAggTrade({ e: "aggTrade", s: "BTCUSDT", p: "100", q: "2", m: true, E: 1, T: 1 });
    expect(buy?.takerSide).toBe("BUY");
    expect(sell?.takerSide).toBe("SELL");
    expect(buy?.quoteNotional).toBe(200);
  });

  it("computes bookTicker spread in bps", () => {
    const event = normalizeBookTicker({ s: "ETHUSDT", b: "100", B: "2", a: "100.2", A: "3" });
    expect(event?.spreadAbsolute).toBeCloseTo(0.2);
    expect(event?.spreadBps).toBeCloseTo(19.98, 2);
    const { spreadBps } = computeSpread(100, 100.2);
    expect(spreadBps).toBe(event?.spreadBps);
  });

  it("shares redis snapshot across readers", async () => {
    const kv = new MemoryKv();
    const writer = new RedisMarketState(kv);
    const reader = new RedisMarketState(kv);
    writer.queueSnapshot({
      symbol: "BTCUSDT",
      lastPrice: 101,
      previousPrice: 100,
      openPrice: 99,
      change24h: 2,
      high24h: 110,
      low24h: 90,
      quoteVolume24h: 1_000,
      baseVolume24h: 10,
      eventTime: Date.now(),
      localReceiveTime: Date.now(),
      lastUpdateAt: Date.now(),
      stale: false,
      rolling: {
        return1s: 0.1,
        return5s: 0.2,
        return15s: null,
        return30s: null,
        return1m: null,
        return3m: null,
        return5m: null,
        return15m: null,
        volumeDelta: null,
        quoteVolumeDelta: null,
      },
    });
    await writer.flush();
    const rows = await reader.readAll();
    expect(rows[0]?.symbol).toBe("BTCUSDT");
    expect(rows[0]?.lastPrice).toBe(101);
  });

  it("distributed REST limiter is shared across instances", async () => {
    const kv = new MemoryKv();
    const a = new DistributedRestLimiter(kv, 10);
    const b = new DistributedRestLimiter(kv, 10);
    await a.spend(10);
    const decision = await b.canSpend(1);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("RATE_BUDGET_EXCEEDED");
  });

  it("does not allow high-priority REST to bypass budget", async () => {
    const kv = new MemoryKv();
    const limiter = new DistributedRestLimiter(kv, 5);
    await limiter.spend(5);
    limiter.noteHighPriorityBypassAttempt();
    const high = await limiter.canSpend(1, "critical");
    expect(high.ok).toBe(false);
    expect(limiter.telemetry.highPriorityBypassAttempts).toBe(1);
  });

  it("respects Retry-After on 429", async () => {
    const limiter = new DistributedRestLimiter(new MemoryKv());
    const until = await limiter.register429({ retryAfterMs: 8_000 });
    const decision = await limiter.canSpend(1);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe("BACKOFF");
      expect(decision.retryAt).toBe(until);
    }
  });

  it("opens 418 ban circuit and stops recovery spam", async () => {
    const limiter = new DistributedRestLimiter(new MemoryKv());
    const until = await limiter.register418({ retryAfterMs: 60_000 });
    const first = await limiter.canSpend(1);
    const second = await limiter.canSpend(1);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (!first.ok) expect(first.reason).toBe("IP_BAN");
    expect(until).toBeGreaterThan(Date.now());
  });

  it("REST recovery single-flight only lets one owner run", async () => {
    const flight = new RestSingleFlight(new MemoryKv());
    let started = 0;
    const first = flight.run("exchangeInfo", async () => {
      started += 1;
      await new Promise((r) => setTimeout(r, 40));
      return "ok";
    });
    await new Promise((r) => setTimeout(r, 10));
    await expect(flight.run("exchangeInfo", async () => "second")).rejects.toThrow(/REST_SINGLE_FLIGHT_BUSY/);
    await expect(first).resolves.toBe("ok");
    expect(started).toBe(1);
  });

  it("resyncs order book on sequence gap", () => {
    const book = new OrderBookAssembler();
    book.applySnapshot({
      lastUpdateId: 10,
      bids: [[100, 1]],
      asks: [[101, 1]],
    });
    const gap = book.applyDelta({
      type: "depth",
      symbol: "BTCUSDT",
      firstUpdateId: 40,
      finalUpdateId: 42,
      bids: [[100, 2]],
      asks: [[101, 2]],
      eventTime: Date.now(),
      receiveTime: Date.now(),
      source: "binance-ws",
    });
    expect(gap).toBe("gap");
    expect(book.needsResync()).toBe(true);
  });

  it("filters tradeable USDT spot universe", () => {
    const rows = filterTradeableUniverse(
      [
        { symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT" },
        { symbol: "ETHBTC", status: "TRADING", baseAsset: "ETH", quoteAsset: "BTC" },
        { symbol: "BTCUPUSDT", status: "TRADING", baseAsset: "BTCUP", quoteAsset: "USDT" },
        { symbol: "USDCUSDT", status: "TRADING", baseAsset: "USDC", quoteAsset: "USDT" },
        { symbol: "ALTUSDT", status: "BREAK", baseAsset: "ALT", quoteAsset: "USDT" },
      ],
      { quoteAssets: ["USDT"] },
    );
    expect(rows.map((row) => row.symbol)).toEqual(["BTCUSDT"]);
  });

  it("keeps memory bounded across a 700-symbol universe", () => {
    const daemon = resetMarketDataDaemonForTests();
    const now = Date.now();
    for (let i = 0; i < 700; i += 1) {
      const symbol = `S${i}USDT`;
      for (let tick = 0; tick < 40; tick += 1) {
        daemon.ingest([miniTicker(symbol, 1 + tick / 100)], now + tick * 1000);
      }
    }
    expect(daemon.store.size).toBe(700);
    expect(daemon.store.maxRingSize()).toBeLessThanOrEqual(1024);
    expect(daemon.store.estimatedMemoryBytes()).toBeLessThan(80 * 1024 * 1024);
    const started = Date.now();
    const snapshot = daemon.getMarketSnapshot();
    expect(snapshot.length).toBe(700);
    expect(Date.now() - started).toBeLessThan(50);
  });

  it("live scanner hot-path public market REST remains zero", async () => {
    const daemon = resetMarketDataDaemonForTests();
    daemon.ingest([
      miniTicker("BTCUSDT", 64000),
      miniTicker("ETHUSDT", 2400),
      miniTicker("SOLUSDT", 140),
    ]);
    resetPublicMarketRestAudit();
    for (const symbol of ["BTCUSDT", "ETHUSDT", "SOLUSDT"]) {
      await marketDataGateway.getTicker(symbol);
      await marketDataGateway.fetchContextBundle({ symbol, lite: true });
    }
    await marketDataGateway.listTickers24h();
    daemon.getMarketSnapshot();
    expect(countHotPathPublicMarketRestCalls()).toBe(0);
    expect(exchangeMocks.getTicker).not.toHaveBeenCalled();
    expect(exchangeMocks.getKlines).not.toHaveBeenCalled();
    expect(exchangeMocks.getOrderBook).not.toHaveBeenCalled();
    expect(exchangeMocks.getRecentTrades).not.toHaveBeenCalled();
  });

  it("canonical critical workers include a single market-data owner", () => {
    const critical = LEGACY_WORKER_REGISTRY.filter((row) => row.tier === "CRITICAL").map((row) => row.id);
    expect(critical).toEqual([...CANONICAL_CRITICAL_WORKER_IDS]);
    expect(critical.filter((id) => id === "market-data-daemon")).toHaveLength(1);
  });
});
