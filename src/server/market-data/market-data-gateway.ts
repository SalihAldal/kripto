import { getExchangeProvider } from "@/src/server/exchange";
import { marketDataOrchestrator } from "@/src/server/market-data/market-data-orchestrator.service";
import type {
  MarketContextBundle,
  MarketDataReadOptions,
  MarketDataTicker,
} from "@/src/server/market-data/market-data.types";
import type { ExchangeInfoResponse, KlineItem, OrderBookSnapshot, RecentTrade } from "@/src/types/exchange";
import {
  MARKET_DATA_NOT_READY_CODE,
  MARKET_DATA_STALE_CODE,
  MarketDataUnavailableError,
} from "@/src/server/market-data/market-data-unavailable.error";
import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";

/**
 * Production scanner hot-path reads RAM/shared WebSocket state only.
 * REST is used solely when `options.recovery === true` (bootstrap / explicit recovery).
 */
export type MarketDataGateway = {
  getTicker(symbol: string, options?: MarketDataReadOptions): Promise<MarketDataTicker>;
  getKlines(symbol: string, interval?: string, limit?: number, options?: MarketDataReadOptions): Promise<KlineItem[]>;
  getOrderBook(symbol: string, limit?: number, options?: MarketDataReadOptions): Promise<OrderBookSnapshot>;
  getRecentTrades(symbol: string, limit?: number, options?: MarketDataReadOptions): Promise<RecentTrade[]>;
  getExchangeInfo(options?: MarketDataReadOptions): Promise<ExchangeInfoResponse>;
  fetchContextBundle(input: {
    symbol: string;
    lite?: boolean;
    priority?: MarketDataReadOptions["priority"];
    maxAgeMs?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
    recovery?: boolean;
  }): Promise<MarketContextBundle>;
  listTickers24h(options?: MarketDataReadOptions): Promise<MarketDataTicker[]>;
};

function notReady(kind: string, symbol?: string): never {
  throw new MarketDataUnavailableError("Market websocket state is not ready", {
    code: MARKET_DATA_NOT_READY_CODE,
    kind,
    symbol,
  });
}

function stale(kind: string, symbol?: string): never {
  throw new MarketDataUnavailableError("Market data is stale", {
    code: MARKET_DATA_STALE_CODE,
    kind,
    symbol,
  });
}

export const marketDataGateway: MarketDataGateway = {
  async getTicker(symbol, options) {
    if (options?.recovery) return marketDataOrchestrator.getTicker(symbol, options);
    const daemon = getMarketDataDaemon();
    const ticker = daemon.toTicker(symbol);
    if (!ticker) notReady("ticker", symbol);
    if (!daemon.isFresh(symbol)) stale("ticker", symbol);
    return ticker;
  },
  async getKlines(symbol, interval = "1m", limit = 100, options) {
    if (options?.recovery) return marketDataOrchestrator.getKlines(symbol, interval, limit, options);
    if (interval !== "1m") notReady("klines", symbol);
    const rows = getMarketDataDaemon().getKlines(symbol, limit);
    if (!rows.length) notReady("klines", symbol);
    return rows;
  },
  async getOrderBook(symbol, limit = 50, options) {
    if (options?.recovery) return marketDataOrchestrator.getOrderBook(symbol, limit, options);
    const book = getMarketDataDaemon().getOrderBook(symbol);
    if (!book || !book.bids.length || !book.asks.length) notReady("orderBook", symbol);
    return {
      lastUpdateId: book.lastUpdateId,
      bids: book.bids.slice(0, limit),
      asks: book.asks.slice(0, limit),
    };
  },
  async getRecentTrades(symbol, limit = 50, options) {
    if (options?.recovery) return marketDataOrchestrator.getRecentTrades(symbol, limit, options);
    const rows = getMarketDataDaemon().getRecentTrades(symbol, limit);
    if (!rows.length) notReady("recentTrades", symbol);
    return rows;
  },
  async getExchangeInfo(options) {
    if (options?.recovery) return marketDataOrchestrator.getExchangeInfo(options);
    const fromRam = getMarketDataDaemon().getExchangeInfoFromUniverse();
    if (fromRam) return fromRam;
    notReady("exchangeInfo");
  },
  async fetchContextBundle(input) {
    if (input.recovery) return marketDataOrchestrator.fetchContextBundle(input);
    const daemon = getMarketDataDaemon();
    if (!input.lite) daemon.subscribeDeep(input.symbol, "scanner-context");
    const bundle = daemon.fetchContextBundle(input.symbol, Boolean(input.lite));
    if (!bundle) notReady("contextBundle", input.symbol);
    return bundle;
  },
  async listTickers24h(options) {
    if (options?.recovery) {
      const provider = getExchangeProvider();
      if (!provider.listTickers24h) {
        throw new MarketDataUnavailableError("Ticker list endpoint unavailable", {
          code: "DATA_UNAVAILABLE",
          kind: "ticker",
        });
      }
      const rows = await provider.listTickers24h();
      return rows.map((row) => ({
        symbol: row.symbol,
        price: row.price,
        change24h: row.change24h,
        volume24h: row.volume24h,
        updatedAt: new Date().toISOString(),
      }));
    }
    const rows = getMarketDataDaemon().listTickers();
    if (!rows.length) notReady("ticker");
    return rows;
  },
};
