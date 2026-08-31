import type {
  MarketBookTickerEvent,
  MarketCandleEvent,
  MarketDepthDeltaEvent,
  MarketTickerEvent,
  MarketTradeEvent,
} from "@/src/server/market-data/spine/events";

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function unwrapBinanceWsPayload(raw: unknown): unknown {
  const rec = asRecord(raw);
  if (!rec) return raw;
  if ("data" in rec && rec.data !== undefined) return rec.data;
  return raw;
}

export function normalizeMiniTicker(raw: unknown, receiveTime = Date.now()): MarketTickerEvent | null {
  const rec = asRecord(unwrapBinanceWsPayload(raw));
  if (!rec) return null;
  const symbol = String(rec.s ?? rec.symbol ?? "").toUpperCase();
  const price = num(rec.c ?? rec.price);
  if (!symbol || !Number.isFinite(price) || price <= 0) return null;
  const openPrice = num(rec.o ?? rec.openPrice);
  const high24h = num(rec.h ?? rec.highPrice);
  const low24h = num(rec.l ?? rec.lowPrice);
  return {
    type: "ticker",
    symbol,
    price,
    openPrice: Number.isFinite(openPrice) ? openPrice : price,
    high24h: Number.isFinite(high24h) ? high24h : price,
    low24h: Number.isFinite(low24h) ? low24h : price,
    quoteVolume: num(rec.q ?? rec.quoteVolume) || 0,
    baseVolume: num(rec.v ?? rec.volume) || 0,
    eventTime: num(rec.E ?? rec.eventTime) || receiveTime,
    receiveTime,
    source: "binance-ws",
  };
}

export function normalizeAggTrade(raw: unknown, receiveTime = Date.now()): MarketTradeEvent | null {
  const rec = asRecord(unwrapBinanceWsPayload(raw));
  if (!rec) return null;
  const symbol = String(rec.s ?? rec.symbol ?? "").toUpperCase();
  const price = num(rec.p ?? rec.price);
  const quantity = num(rec.q ?? rec.quantity ?? rec.qty);
  if (!symbol || !Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity)) return null;
  const buyerMaker = Boolean(rec.m ?? rec.isBuyerMaker);
  return {
    type: "trade",
    symbol,
    price,
    quantity,
    quoteNotional: Number((price * quantity).toFixed(8)),
    eventTime: num(rec.E ?? rec.eventTime) || receiveTime,
    tradeTime: num(rec.T ?? rec.tradeTime) || receiveTime,
    receiveTime,
    buyerMaker,
    takerSide: buyerMaker ? "SELL" : "BUY",
    aggregateId: Number.isFinite(num(rec.a)) ? num(rec.a) : undefined,
    source: "binance-ws",
  };
}

export function computeSpread(bestBid: number, bestAsk: number) {
  const spreadAbsolute = Number((bestAsk - bestBid).toFixed(8));
  const mid = (bestBid + bestAsk) / 2;
  const spreadBps = mid > 0 ? Number(((spreadAbsolute / mid) * 10_000).toFixed(4)) : 0;
  return { spreadAbsolute, spreadBps };
}

export function normalizeBookTicker(raw: unknown, receiveTime = Date.now()): MarketBookTickerEvent | null {
  const rec = asRecord(unwrapBinanceWsPayload(raw));
  if (!rec) return null;
  const symbol = String(rec.s ?? rec.symbol ?? "").toUpperCase();
  const bestBid = num(rec.b ?? rec.bestBid);
  const bestAsk = num(rec.a ?? rec.bestAsk);
  const bestBidQty = num(rec.B ?? rec.bestBidQty);
  const bestAskQty = num(rec.A ?? rec.bestAskQty);
  if (!symbol || !Number.isFinite(bestBid) || !Number.isFinite(bestAsk) || bestBid <= 0 || bestAsk <= 0) return null;
  const { spreadAbsolute, spreadBps } = computeSpread(bestBid, bestAsk);
  return {
    type: "bookTicker",
    symbol,
    bestBid,
    bestBidQty: Number.isFinite(bestBidQty) ? bestBidQty : 0,
    bestAsk,
    bestAskQty: Number.isFinite(bestAskQty) ? bestAskQty : 0,
    spreadAbsolute,
    spreadBps,
    eventTime: num(rec.E ?? rec.eventTime) || receiveTime,
    receiveTime,
    updateId: Number.isFinite(num(rec.u)) ? num(rec.u) : undefined,
    source: "binance-ws",
  };
}

export function normalizeKline(raw: unknown, receiveTime = Date.now()): MarketCandleEvent | null {
  const rec = asRecord(unwrapBinanceWsPayload(raw));
  if (!rec) return null;
  const k = asRecord(rec.k) ?? rec;
  const symbol = String(rec.s ?? k.s ?? "").toUpperCase();
  const close = num(k.c ?? k.close);
  if (!symbol || !Number.isFinite(close) || close <= 0) return null;
  return {
    type: "candle",
    symbol,
    interval: String(k.i ?? k.interval ?? "1m"),
    openTime: num(k.t ?? k.openTime) || 0,
    closeTime: num(k.T ?? k.closeTime) || 0,
    open: num(k.o ?? k.open) || close,
    high: num(k.h ?? k.high) || close,
    low: num(k.l ?? k.low) || close,
    close,
    volume: num(k.v ?? k.volume) || 0,
    quoteVolume: num(k.q ?? k.quoteVolume) || 0,
    closed: Boolean(k.x ?? k.closed),
    eventTime: num(rec.E ?? rec.eventTime) || receiveTime,
    receiveTime,
    source: "binance-ws",
  };
}

export function normalizeDepthDelta(raw: unknown, receiveTime = Date.now()): MarketDepthDeltaEvent | null {
  const rec = asRecord(unwrapBinanceWsPayload(raw));
  if (!rec) return null;
  const symbol = String(rec.s ?? rec.symbol ?? "").toUpperCase();
  const firstUpdateId = num(rec.U);
  const finalUpdateId = num(rec.u);
  if (!symbol || !Number.isFinite(firstUpdateId) || !Number.isFinite(finalUpdateId)) return null;
  const mapLevels = (rows: unknown): Array<[number, number]> => {
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => {
        if (!Array.isArray(row) || row.length < 2) return null;
        const price = num(row[0]);
        const qty = num(row[1]);
        if (!Number.isFinite(price) || !Number.isFinite(qty)) return null;
        return [price, qty] as [number, number];
      })
      .filter((row): row is [number, number] => Boolean(row));
  };
  return {
    type: "depth",
    symbol,
    firstUpdateId,
    finalUpdateId,
    bids: mapLevels(rec.b ?? rec.bids),
    asks: mapLevels(rec.a ?? rec.asks),
    eventTime: num(rec.E ?? rec.eventTime) || receiveTime,
    receiveTime,
    source: "binance-ws",
  };
}

export function classifyBinanceWsMessage(raw: unknown): "ticker" | "trade" | "bookTicker" | "kline" | "depth" | "array" | "other" {
  if (Array.isArray(raw)) return "array";
  const rec = asRecord(unwrapBinanceWsPayload(raw));
  if (!rec) return "other";
  const event = String(rec.e ?? "");
  if (event === "24hrMiniTicker" || event === "24hrTicker") return "ticker";
  if (event === "aggTrade" || event === "trade") return "trade";
  if (event === "kline") return "kline";
  if (event === "depthUpdate") return "depth";
  if (typeof rec.b === "string" && typeof rec.a === "string" && typeof rec.B === "string") return "bookTicker";
  if (rec.s && rec.c && rec.q) return "ticker";
  return "other";
}
