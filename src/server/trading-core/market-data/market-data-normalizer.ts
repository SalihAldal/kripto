import type { MarketCandle, MarketTick } from "@/src/server/trading-core/core/types";
import type {
  MarketDataNormalizationStats,
  MarketDataQualityIssue,
  MarketDataSource,
  NormalizedMarketCandle,
  NormalizedMarketTick,
  RawMarketCandle,
  RawMarketTick,
} from "@/src/server/trading-core/market-data/market-data-types";

const MAX_ISSUES = 200;
const MAX_FUTURE_DRIFT_MS = 10_000;
const MAX_LATENCY_MS = 15_000;

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSymbol(value?: string) {
  return value?.trim().toUpperCase() ?? "";
}

export class MarketDataNormalizer {
  private stats: MarketDataNormalizationStats = {
    normalizedTicks: 0,
    normalizedCandles: 0,
    droppedTicks: 0,
    droppedCandles: 0,
    repairedCandles: 0,
    latencyCompensations: 0,
    issues: [],
    updatedAt: new Date().toISOString(),
  };

  normalizeTick(raw: RawMarketTick): NormalizedMarketTick | null {
    const symbol = normalizeSymbol(raw.symbol);
    const price = toNumber(raw.price);
    const volume = toNumber(raw.volume ?? 0);
    const receivedAt = toNumber(raw.receivedAt) ?? Date.now();
    const eventTime = this.syncTimestamp(toNumber(raw.eventTime), receivedAt, raw.source, symbol);
    if (!symbol) return this.dropTick(raw.source, "MISSING_FIELD", "Tick symbol missing");
    if (!price || price <= 0) return this.dropTick(raw.source, "INVALID_PRICE", "Tick price invalid", symbol);
    if (volume === null || volume < 0) return this.dropTick(raw.source, "INVALID_VOLUME", "Tick volume invalid", symbol);
    if (!eventTime) return this.dropTick(raw.source, "INVALID_TIMESTAMP", "Tick timestamp invalid", symbol);
    const latencyMs = Math.max(0, receivedAt - eventTime);
    if (latencyMs > MAX_LATENCY_MS) {
      this.issue(raw.source, "LATENCY_COMPENSATED", `Tick latency compensated: ${latencyMs}ms`, symbol);
      this.stats.latencyCompensations += 1;
    }
    this.stats.normalizedTicks += 1;
    this.touch();
    return {
      symbol,
      price,
      volume,
      eventTime,
      source: raw.source,
      receivedAt,
      latencyMs,
      normalizedAt: new Date().toISOString(),
    };
  }

  normalizeCandle(raw: RawMarketCandle): NormalizedMarketCandle | null {
    const symbol = normalizeSymbol(raw.symbol);
    const openTime = toNumber(raw.openTime);
    const closeTime = toNumber(raw.closeTime);
    const open = toNumber(raw.open);
    const high = toNumber(raw.high);
    const low = toNumber(raw.low);
    const close = toNumber(raw.close);
    const volume = toNumber(raw.volume ?? 0);
    if (!symbol) return this.dropCandle(raw.source, "MISSING_FIELD", "Candle symbol missing");
    if (!openTime || !closeTime || closeTime <= openTime) return this.dropCandle(raw.source, "INVALID_TIMESTAMP", "Candle timestamp invalid", symbol);
    if (!open || !high || !low || !close || [open, high, low, close].some((price) => price <= 0)) {
      return this.dropCandle(raw.source, "INVALID_PRICE", "Candle OHLC price invalid", symbol);
    }
    if (volume === null || volume < 0) return this.dropCandle(raw.source, "INVALID_VOLUME", "Candle volume invalid", symbol);
    if (high < Math.max(open, close) || low > Math.min(open, close)) {
      return this.dropCandle(raw.source, "CORRUPTED_OHLC", "Candle OHLC structure corrupted", symbol);
    }
    this.stats.normalizedCandles += 1;
    this.touch();
    return {
      symbol,
      openTime,
      closeTime,
      open,
      high,
      low,
      close,
      volume,
      source: raw.source,
      normalizedAt: new Date().toISOString(),
    };
  }

  fromMarketTick(tick: MarketTick, source: MarketDataSource = "BINANCE") {
    return this.normalizeTick({
      source,
      symbol: tick.symbol,
      price: tick.price,
      volume: tick.volume,
      eventTime: tick.eventTime,
      receivedAt: Date.now(),
    });
  }

  toMarketTick(tick: NormalizedMarketTick): MarketTick {
    return {
      symbol: tick.symbol,
      price: tick.price,
      volume: tick.volume,
      eventTime: tick.eventTime,
    };
  }

  toMarketCandle(candle: NormalizedMarketCandle): MarketCandle {
    return {
      symbol: candle.symbol,
      openTime: candle.openTime,
      closeTime: candle.closeTime,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    };
  }

  snapshot() {
    return { ...this.stats, issues: [...this.stats.issues] };
  }

  markRepaired(source: MarketDataSource, symbol: string, count = 1) {
    this.stats.repairedCandles += count;
    this.issue(source, "MISSING_CANDLE_REPAIRED", `${count} missing candle(s) repaired`, symbol);
  }

  private syncTimestamp(value: number | null, receivedAt: number, source: MarketDataSource, symbol?: string) {
    if (!value || value <= 0) return null;
    if (value > receivedAt + MAX_FUTURE_DRIFT_MS) {
      this.issue(source, "INVALID_TIMESTAMP", "Future timestamp drift corrected", symbol);
      return receivedAt;
    }
    return value;
  }

  private dropTick(source: MarketDataSource, type: MarketDataQualityIssue["type"], message: string, symbol?: string) {
    this.stats.droppedTicks += 1;
    this.issue(source, type, message, symbol);
    return null;
  }

  private dropCandle(source: MarketDataSource, type: MarketDataQualityIssue["type"], message: string, symbol?: string) {
    this.stats.droppedCandles += 1;
    this.issue(source, type, message, symbol);
    return null;
  }

  private issue(source: MarketDataSource, type: MarketDataQualityIssue["type"], message: string, symbol?: string) {
    this.stats.issues.unshift({ source, symbol, type, message, createdAt: new Date().toISOString() });
    if (this.stats.issues.length > MAX_ISSUES) this.stats.issues.length = MAX_ISSUES;
    this.touch();
  }

  private touch() {
    this.stats.updatedAt = new Date().toISOString();
  }
}

const globalNormalizer = globalThis as typeof globalThis & { __marketDataNormalizer?: MarketDataNormalizer };
export const marketDataNormalizer = globalNormalizer.__marketDataNormalizer ?? new MarketDataNormalizer();
globalNormalizer.__marketDataNormalizer = marketDataNormalizer;
