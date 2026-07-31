import type { RawMarketCandle, RawMarketTick } from "@/src/server/trading-core/market-data/market-data-types";

type UnknownRecord = Record<string, unknown>;

export const marketDataSourceAdapters = {
  binanceTicker(payload: UnknownRecord): RawMarketTick {
    return {
      source: "BINANCE",
      symbol: String(payload.s ?? payload.symbol ?? ""),
      price: payload.c ?? payload.price,
      volume: payload.q ?? payload.volume,
      eventTime: payload.E ?? payload.eventTime,
    };
  },

  bybitTicker(payload: UnknownRecord): RawMarketTick {
    return {
      source: "BYBIT",
      symbol: String(payload.symbol ?? ""),
      price: payload.lastPrice ?? payload.price,
      volume: payload.volume24h ?? payload.volume,
      eventTime: payload.ts ?? payload.time,
    };
  },

  okxTicker(payload: UnknownRecord): RawMarketTick {
    return {
      source: "OKX",
      symbol: String(payload.instId ?? payload.symbol ?? "").replace("-", ""),
      price: payload.last ?? payload.price,
      volume: payload.volCcy24h ?? payload.volume,
      eventTime: payload.ts,
    };
  },

  tradingViewCandle(payload: UnknownRecord): RawMarketCandle {
    return {
      source: "TRADINGVIEW",
      symbol: String(payload.symbol ?? ""),
      openTime: payload.time,
      closeTime: Number(payload.time) + 60_000 - 1,
      open: payload.open,
      high: payload.high,
      low: payload.low,
      close: payload.close,
      volume: payload.volume,
    };
  },

  coinglassFunding(payload: UnknownRecord): RawMarketTick {
    return {
      source: "COINGLASS",
      symbol: String(payload.symbol ?? ""),
      price: payload.price ?? payload.indexPrice,
      volume: 0,
      eventTime: payload.updateTime ?? payload.time,
    };
  },

  fundingApi(payload: UnknownRecord): RawMarketTick {
    return {
      source: "FUNDING_API",
      symbol: String(payload.symbol ?? ""),
      price: payload.markPrice ?? payload.price,
      volume: 0,
      eventTime: payload.timestamp ?? payload.time,
    };
  },
};
