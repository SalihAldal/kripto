import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { getRedis } from "@/lib/redis";
import { getExchangeProvider } from "@/src/server/exchange";
import { MarketStateStore } from "@/src/server/market-data/spine/market-state-store";
import {
  DynamicSubscriptionManager,
  type DeepStreamKind,
} from "@/src/server/market-data/spine/dynamic-subscription-manager";
import { OrderBookAssembler } from "@/src/server/market-data/spine/order-book-assembler";
import {
  classifyBinanceWsMessage,
  normalizeAggTrade,
  normalizeBookTicker,
  normalizeDepthDelta,
  normalizeKline,
  normalizeMiniTicker,
} from "@/src/server/market-data/spine/payload-normalizer";
import { RedisMarketState } from "@/src/server/market-data/spine/redis-market-state";
import { createRedisKvAdapter, MemoryKv, type SharedKv } from "@/src/server/market-data/spine/shared-kv";
import { RestSingleFlight } from "@/src/server/market-data/spine/rest-single-flight";
import { recordPublicMarketRestCall, getPublicMarketRestCallsPerMinute } from "@/src/server/market-data/spine/rest-call-audit";
import { bindSharedRestLimiterKv, getSharedRestLimiter } from "@/src/server/market-data/spine/shared-rest-limiter";
import { filterTradeableUniverse, resolveQuoteAssets, type TradeableSymbol } from "@/src/server/market-data/spine/universe";
import { FakeMarketSocket, WsConnection, type SocketFactory, type WsLifecycleState } from "@/src/server/market-data/spine/ws-connection";
import type { ExchangeInfoResponse, KlineItem, OrderBookSnapshot, RecentTrade } from "@/src/types/exchange";
import type { MarketContextBundle, MarketDataTicker } from "@/src/server/market-data/market-data.types";
import { createRuntimeInstanceId } from "@/src/server/runtime/instance-id";

const DEFAULT_DEEP_KINDS: DeepStreamKind[] = ["aggTrade", "bookTicker", "kline_1m"];
const UNIVERSE_TTL_MS = 6 * 60 * 60 * 1000;

export type MarketDataDaemonTelemetry = {
  instanceId: string;
  dynamicSubscriptionManagerInstanceId: string;
  wsLightState: WsLifecycleState;
  wsDeepState: WsLifecycleState;
  uptimeMs: number;
  reconnectCount: number;
  eventsPerSec: number;
  symbolsTracked: number;
  liveSymbols: number;
  universeSize: number;
  coveragePct: number;
  staleSymbols: number;
  deepSubscriptions: number;
  ingestionLagMs: number;
  ingestionP50Ms: number;
  ingestionP95Ms: number;
  snapshotReadP50Ms: number;
  snapshotReadP95Ms: number;
  redisLatencyMs: number;
  restCallsPerMin: number;
  estimatedWeight: number;
  actualWeight: number | null;
  rateLimited429: number;
  banned418: number;
  memoryBytes: number;
  socketOpen: number;
  socketClose: number;
  reconnectAttempt: number;
  reconnectSuccess: number;
  subscriptionAdded: number;
  subscriptionRemoved: number;
  plannedRotation: number;
  recentSocketCloses: Array<{
    connectionId: string;
    timestamp: string;
    closeCode: number | null;
    closeReason: string;
    uptimeMs: number;
    activeSubscriptions: number;
  }>;
};

export type MarketDataDaemonOptions = {
  socketFactory?: SocketFactory;
  kv?: SharedKv;
  wsBase?: string;
  autoConnect?: boolean;
  now?: () => number;
};

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function resolveBinanceWsBase(platform: "global" | "tr" = env.BINANCE_PLATFORM) {
  if (env.BINANCE_WS_BASE) return env.BINANCE_WS_BASE.replace(/\/$/, "");
  return platform === "tr" ? "wss://stream.binance.com:9443" : "wss://stream.binance.com:9443";
}

export class MarketDataDaemon {
  readonly instanceId = createRuntimeInstanceId("market-data-daemon");
  readonly store: MarketStateStore;
  readonly subscriptions = new DynamicSubscriptionManager();
  readonly limiter = getSharedRestLimiter();
  readonly singleFlight: RestSingleFlight;
  readonly redisState: RedisMarketState;
  universe: TradeableSymbol[] = [];
  universeRefreshedAt = 0;
  running = false;
  startedAt = 0;
  private light?: WsConnection;
  private deep?: WsConnection;
  private readonly books = new Map<string, OrderBookAssembler>();
  private readonly ingestLag: number[] = [];
  private readonly snapshotReadLag: number[] = [];
  private eventsWindow: number[] = [];
  private subscribeQueue: Array<{ method: "SUBSCRIBE" | "UNSUBSCRIBE"; params: string[] }> = [];
  private subscribeTimer: ReturnType<typeof setInterval> | null = null;
  private klineGapSymbols = new Set<string>();
  private fakeLight: FakeMarketSocket | null = null;
  private fakeDeep: FakeMarketSocket | null = null;
  private readonly options: MarketDataDaemonOptions;
  private kv: SharedKv;
  private wsLifecycle = {
    socketOpen: 0,
    socketClose: 0,
    reconnectAttempt: 0,
    reconnectSuccess: 0,
    subscriptionAdded: 0,
    subscriptionRemoved: 0,
    plannedRotation: 0,
    recentSocketCloses: [] as MarketDataDaemonTelemetry["recentSocketCloses"],
  };

  constructor(options: MarketDataDaemonOptions = {}) {
    this.options = options;
    this.store = new MarketStateStore(env.MARKET_DATA_STALE_MS);
    this.kv = options.kv ?? new MemoryKv();
    this.limiter.setKv(this.kv);
    this.singleFlight = new RestSingleFlight(this.kv);
    this.redisState = new RedisMarketState(this.kv);
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();
    if (!this.options.kv) {
      const redis = getRedis();
      if (redis) {
        try {
          if (redis.status === "wait") await redis.connect().catch(() => undefined);
          this.kv = createRedisKvAdapter(redis);
        } catch {
          logger.warn("MarketDataDaemon Redis unavailable; using in-process KV");
        }
      }
    }
    this.limiter.setKv(this.kv);
    bindSharedRestLimiterKv(this.kv);
    this.singleFlight.setKv(this.kv);
    this.redisState.setKv(this.kv);
    this.redisState.start(400);
    await this.refreshUniverse({ recovery: true }).catch((error) => {
      logger.warn({ err: error }, "MarketDataDaemon universe bootstrap failed");
    });
    if (this.options.autoConnect !== false) this.connectStreams();
    this.subscribeTimer = setInterval(() => this.flushSubscribeQueue(), 220);
    logger.info({ universe: this.universe.length }, "MarketDataDaemon started");
  }

  stop() {
    this.running = false;
    this.light?.stop();
    this.deep?.stop();
    this.redisState.stop();
    if (this.subscribeTimer) clearInterval(this.subscribeTimer);
    this.subscribeTimer = null;
  }

  connectStreams() {
    const wsBase = this.options.wsBase ?? resolveBinanceWsBase();
    const factory = this.options.socketFactory;
    this.light = new WsConnection({
      name: "binance-miniTicker",
      url: `${wsBase}/ws/!miniTicker@arr`,
      factory,
      onMessage: (raw, receiveTime) => this.ingest(raw, receiveTime),
      onOpen: () => {
        this.wsLifecycle.socketOpen += 1;
        this.wsLifecycle.reconnectSuccess += 1;
        logger.info("MarketDataDaemon all-market stream connected");
      },
      onClose: (meta) => this.recordSocketClose(meta),
      onReconnectAttempt: () => {
        this.wsLifecycle.reconnectAttempt += 1;
      },
      onPlannedRotation: () => {
        this.wsLifecycle.plannedRotation += 1;
      },
    });
    this.deep = new WsConnection({
      name: "binance-deep",
      url: `${wsBase}/ws`,
      factory,
      onMessage: (raw, receiveTime) => this.ingest(raw, receiveTime),
      onOpen: () => {
        this.wsLifecycle.socketOpen += 1;
        this.wsLifecycle.reconnectSuccess += 1;
        this.restoreDeepSubscriptions();
      },
      onClose: (meta) => this.recordSocketClose(meta),
      onReconnectAttempt: () => {
        this.wsLifecycle.reconnectAttempt += 1;
      },
      onPlannedRotation: () => {
        this.wsLifecycle.plannedRotation += 1;
      },
    });
    this.light.start();
    this.deep.start();
  }

  ingest(raw: unknown, receiveTime = Date.now()) {
    this.eventsWindow.push(receiveTime);
    const lagStart = receiveTime;
    const kind = classifyBinanceWsMessage(raw);
    if (kind === "array" && Array.isArray(raw)) {
      for (const row of raw) this.applyTicker(row, receiveTime);
    } else if (kind === "ticker") {
      this.applyTicker(raw, receiveTime);
    } else if (kind === "trade") {
      const event = normalizeAggTrade(raw, receiveTime);
      if (event) this.store.applyTrade(event);
    } else if (kind === "bookTicker") {
      const event = normalizeBookTicker(raw, receiveTime);
      if (event) this.store.applyBookTicker(event, receiveTime);
    } else if (kind === "kline") {
      const event = normalizeKline(raw, receiveTime);
      if (event) {
        const existing = this.store.getKlines(event.symbol, 2);
        const last = existing[existing.length - 1];
        if (last && event.closed && event.openTime - last.openTime > 90_000) {
          this.klineGapSymbols.add(event.symbol);
        }
        this.store.applyCandle(event);
      }
    } else if (kind === "depth") {
      const event = normalizeDepthDelta(raw, receiveTime);
      if (event) this.applyDepth(event);
    }
    this.ingestLag.push(Date.now() - lagStart);
    if (this.ingestLag.length > 400) this.ingestLag.splice(0, this.ingestLag.length - 400);
  }

  getLatest(symbol: string) {
    return this.store.getLatest(symbol);
  }

  getWindow(symbol: string, durationMs: number) {
    return this.store.getWindow(symbol, durationMs);
  }

  getMarketSnapshot() {
    const started = Date.now();
    const rows = this.store.getMarketSnapshot();
    this.snapshotReadLag.push(Date.now() - started);
    if (this.snapshotReadLag.length > 200) this.snapshotReadLag.splice(0, this.snapshotReadLag.length - 200);
    return rows;
  }

  getDeepState(symbol: string) {
    return this.store.getDeepState(symbol);
  }

  isFresh(symbol: string) {
    return this.store.isFresh(symbol);
  }

  toTicker(symbol: string): MarketDataTicker | null {
    const row = this.store.getLatest(symbol);
    if (!row) return null;
    return {
      symbol: row.symbol,
      price: row.lastPrice,
      change24h: row.change24h,
      volume24h: row.quoteVolume24h,
      updatedAt: new Date(row.lastUpdateAt).toISOString(),
    };
  }

  listTickers(): MarketDataTicker[] {
    return this.getMarketSnapshot().map((row) => ({
      symbol: row.symbol,
      price: row.lastPrice,
      change24h: row.change24h,
      volume24h: row.quoteVolume24h,
      updatedAt: new Date(row.lastUpdateAt).toISOString(),
    }));
  }

  getKlines(symbol: string, limit = 100): KlineItem[] {
    return this.store.getKlines(symbol, limit);
  }

  getOrderBook(symbol: string): OrderBookSnapshot | null {
    const fromAssembler = this.books.get(symbol.toUpperCase());
    if (fromAssembler && !fromAssembler.needsResync()) return fromAssembler.snapshot();
    const bookTicker = this.store.getDeepState(symbol)?.bookTicker;
    if (!bookTicker) return this.store.getOrderBook(symbol);
    return {
      lastUpdateId: bookTicker.eventTime,
      bids: [{ price: bookTicker.bestBid, quantity: bookTicker.bestBidQty }],
      asks: [{ price: bookTicker.bestAsk, quantity: bookTicker.bestAskQty }],
    };
  }

  getRecentTrades(symbol: string, limit = 50): RecentTrade[] {
    return this.store.getRecentTrades(symbol, limit);
  }

  fetchContextBundle(symbol: string, lite = false): MarketContextBundle | null {
    const ticker = this.toTicker(symbol);
    if (!ticker) return null;
    return {
      symbol: ticker.symbol,
      ticker,
      klines1m: this.getKlines(symbol, 80),
      orderBook: lite ? null : this.getOrderBook(symbol),
      recentTrades: lite ? null : this.getRecentTrades(symbol, 150),
      klines1h: [],
    };
  }

  subscribeDeep(symbol: string, owner: string, kinds: DeepStreamKind[] = DEFAULT_DEEP_KINDS) {
    const added = this.subscriptions.subscribe(symbol, kinds, owner);
    if (added.length > 0) this.wsLifecycle.subscriptionAdded += added.length;
    if (added.length) this.enqueue("SUBSCRIBE", added);
    if (kinds.includes("kline_1m")) {
      void this.bootstrapKlines(symbol).catch(() => undefined);
    }
    if (kinds.includes("depth")) {
      void this.bootstrapDepth(symbol).catch(() => undefined);
    }
    return added;
  }

  unsubscribeDeep(symbol: string, owner: string, kinds: DeepStreamKind[] = DEFAULT_DEEP_KINDS) {
    const removed = this.subscriptions.unsubscribe(symbol, kinds, owner);
    if (removed.length > 0) this.wsLifecycle.subscriptionRemoved += removed.length;
    if (removed.length) this.enqueue("UNSUBSCRIBE", removed);
    return removed;
  }

  async refreshUniverse(input?: { recovery?: boolean }) {
    const now = Date.now();
    if (this.universe.length && now - this.universeRefreshedAt < UNIVERSE_TTL_MS) return this.universe;
    return this.singleFlight.run("exchangeInfo", async () => {
      recordPublicMarketRestCall({
        kind: "exchangeInfo",
        path: "/api/v3/exchangeInfo",
        source: "MarketDataDaemon.refreshUniverse",
        recovery: Boolean(input?.recovery),
      });
      const provider = getExchangeProvider();
      const info = await provider.getExchangeInfo();
      const quotes = resolveQuoteAssets(env.BINANCE_PLATFORM, env.MARKET_DATA_QUOTE_ASSETS);
      this.universe = filterTradeableUniverse(info.symbols, { quoteAssets: quotes });
      this.universeRefreshedAt = Date.now();
      await this.redisState.writeUniverse(this.universe.map((row) => row.symbol));
      return this.universe;
    });
  }

  getExchangeInfoFromUniverse(): ExchangeInfoResponse | null {
    if (!this.universe.length) return null;
    return {
      timezone: "UTC",
      serverTime: Date.now(),
      symbols: this.universe.map((row) => ({
        symbol: row.symbol,
        status: row.status,
        baseAsset: row.baseAsset,
        quoteAsset: row.quoteAsset,
        filters: {},
      })),
    };
  }

  telemetry(): MarketDataDaemonTelemetry {
    const now = Date.now();
    this.eventsWindow = this.eventsWindow.filter((ts) => now - ts <= 1_000);
    const universeSize = this.universe.length || this.store.size;
    const live = this.store.liveSymbolCount(now);
    return {
      instanceId: this.instanceId,
      dynamicSubscriptionManagerInstanceId: this.subscriptions.instanceId,
      wsLightState: this.light?.state ?? "IDLE",
      wsDeepState: this.deep?.state ?? "IDLE",
      uptimeMs: this.light?.uptimeMs ?? 0,
      reconnectCount: (this.light?.reconnectCount ?? 0) + (this.deep?.reconnectCount ?? 0),
      eventsPerSec: this.eventsWindow.length,
      symbolsTracked: this.store.size,
      liveSymbols: live,
      universeSize,
      coveragePct: universeSize > 0 ? Number(((live / universeSize) * 100).toFixed(2)) : 0,
      staleSymbols: this.store.staleSymbols(now).length,
      deepSubscriptions: this.subscriptions.desiredStreams().length,
      ingestionLagMs: this.ingestLag[this.ingestLag.length - 1] ?? 0,
      ingestionP50Ms: percentile(this.ingestLag, 50),
      ingestionP95Ms: percentile(this.ingestLag, 95),
      snapshotReadP50Ms: percentile(this.snapshotReadLag, 50),
      snapshotReadP95Ms: percentile(this.snapshotReadLag, 95),
      redisLatencyMs: this.redisState.lastLatencyMs,
      restCallsPerMin: getPublicMarketRestCallsPerMinute(),
      estimatedWeight: this.limiter.telemetry.estimatedWeight,
      actualWeight: this.limiter.telemetry.actualWeight,
      rateLimited429: this.limiter.telemetry.rateLimited429,
      banned418: this.limiter.telemetry.banned418,
      memoryBytes: this.store.estimatedMemoryBytes(),
      socketOpen: this.wsLifecycle.socketOpen,
      socketClose: this.wsLifecycle.socketClose,
      reconnectAttempt: this.wsLifecycle.reconnectAttempt,
      reconnectSuccess: this.wsLifecycle.reconnectSuccess,
      subscriptionAdded: this.wsLifecycle.subscriptionAdded,
      subscriptionRemoved: this.wsLifecycle.subscriptionRemoved,
      plannedRotation: this.wsLifecycle.plannedRotation,
      recentSocketCloses: this.wsLifecycle.recentSocketCloses.slice(-20),
    };
  }

  attachFakeSockets(light: FakeMarketSocket, deep: FakeMarketSocket) {
    this.fakeLight = light;
    this.fakeDeep = deep;
  }

  restoreDeepSubscriptions() {
    const streams = this.subscriptions.desiredStreams();
    if (!streams.length) return;
    this.enqueue("SUBSCRIBE", streams);
  }

  flushCommandQueue() {
    this.flushSubscribeQueue();
  }

  hasKlineGap(symbol: string) {
    return this.klineGapSymbols.has(symbol.toUpperCase());
  }

  private applyTicker(raw: unknown, receiveTime: number) {
    const event = normalizeMiniTicker(raw, receiveTime);
    if (!event) return;
    if (this.universe.length && !this.universe.some((row) => row.symbol === event.symbol)) {
      // still keep live state for known tradeable symbols; skip non-universe noise
      if (!event.symbol.endsWith("USDT") && !event.symbol.endsWith("TRY")) return;
    }
    this.store.applyTicker(event, receiveTime);
    this.redisState.queueSnapshot(this.store.getLatest(event.symbol, receiveTime)!);
  }

  private applyDepth(event: ReturnType<typeof normalizeDepthDelta>) {
    if (!event) return;
    const assembler = this.books.get(event.symbol) ?? new OrderBookAssembler();
    this.books.set(event.symbol, assembler);
    const result = assembler.applyDelta(event);
    if (result === "gap" || assembler.needsResync()) {
      this.store.setOrderBook(event.symbol, assembler.snapshot(), false, true);
      void this.bootstrapDepth(event.symbol).catch(() => undefined);
      return;
    }
    if (assembler.status === "LIVE") {
      this.store.setOrderBook(event.symbol, assembler.snapshot(), true, false);
    }
  }

  private enqueue(method: "SUBSCRIBE" | "UNSUBSCRIBE", params: string[]) {
    this.subscribeQueue.push({ method, params });
  }

  private flushSubscribeQueue() {
    const next = this.subscribeQueue.shift();
    if (!next) return;
    this.deep?.send({ method: next.method, params: next.params, id: Date.now() });
  }

  private async bootstrapKlines(symbol: string) {
    if (this.store.getKlines(symbol, 2).length >= 2) return;
    await this.singleFlight.run(`klines:${symbol}:1m`, async () => {
      recordPublicMarketRestCall({
        kind: "klines",
        path: "/api/v3/klines",
        symbol,
        source: "MarketDataDaemon.bootstrapKlines",
        recovery: true,
      });
      const rows = await getExchangeProvider().getKlines(symbol, "1m", 80);
      this.store.seedKlines(symbol, rows);
    });
  }

  private async bootstrapDepth(symbol: string) {
    const assembler = this.books.get(symbol.toUpperCase()) ?? new OrderBookAssembler();
    this.books.set(symbol.toUpperCase(), assembler);
    assembler.beginSnapshot();
    await this.singleFlight.run(`depth:${symbol}`, async () => {
      recordPublicMarketRestCall({
        kind: "orderBook",
        path: "/api/v3/depth",
        symbol,
        source: "MarketDataDaemon.bootstrapDepth",
        recovery: true,
      });
      const book = await getExchangeProvider().getOrderBook(symbol, 50);
      assembler.applySnapshot({
        lastUpdateId: book.lastUpdateId ?? 0,
        bids: book.bids.map((row) => [row.price, row.quantity]),
        asks: book.asks.map((row) => [row.price, row.quantity]),
      });
      this.store.setOrderBook(symbol, assembler.snapshot(), assembler.status === "LIVE", assembler.gapDetected);
    });
  }

  private recordSocketClose(meta: { connectionId: string; at: number; closeCode?: number; closeReason?: string; uptimeMs: number }) {
    this.wsLifecycle.socketClose += 1;
    this.wsLifecycle.recentSocketCloses.push({
      connectionId: meta.connectionId,
      timestamp: new Date(meta.at).toISOString(),
      closeCode: Number.isFinite(Number(meta.closeCode)) ? Number(meta.closeCode) : null,
      closeReason: String(meta.closeReason ?? ""),
      uptimeMs: Math.max(0, Number(meta.uptimeMs ?? 0)),
      activeSubscriptions: this.subscriptions.desiredStreams().length,
    });
    if (this.wsLifecycle.recentSocketCloses.length > 120) {
      this.wsLifecycle.recentSocketCloses.splice(0, this.wsLifecycle.recentSocketCloses.length - 120);
    }
  }
}

const globalRef = globalThis as typeof globalThis & { __kineticMarketDataDaemon?: MarketDataDaemon };

export function getMarketDataDaemon() {
  if (!globalRef.__kineticMarketDataDaemon) {
    globalRef.__kineticMarketDataDaemon = new MarketDataDaemon();
  }
  return globalRef.__kineticMarketDataDaemon;
}

export function resetMarketDataDaemonForTests(instance?: MarketDataDaemon) {
  globalRef.__kineticMarketDataDaemon?.stop();
  globalRef.__kineticMarketDataDaemon = instance ?? new MarketDataDaemon({ autoConnect: false, kv: new MemoryKv() });
  return globalRef.__kineticMarketDataDaemon;
}

export function isMarketDataDaemonReady() {
  const daemon = globalRef.__kineticMarketDataDaemon;
  if (!daemon) return false;
  return daemon.store.size > 0 || daemon.running;
}
