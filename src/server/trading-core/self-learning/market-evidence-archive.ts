import { env } from "@/lib/config";
import { getKlines, getOrderBook, getRecentTrades, getTicker } from "@/services/binance.service";
import { toGlobalLeverageSymbol } from "@/services/binance-global.service";
import type { KlineItem, OrderBookSnapshot, RecentTrade } from "@/src/types/exchange";

export type LearningMarketEvidenceSnapshot = {
  symbol: string;
  futuresSymbol: string;
  capturedAt: string;
  summary: {
    spotLastPrice?: number;
    spotBidPrice?: number;
    spotAskPrice?: number;
    spotSpreadPercent?: number;
    spotVolume24h?: number;
    orderBookBidDepth?: number;
    orderBookAskDepth?: number;
    orderBookImbalance?: number;
    recentBuyVolume?: number;
    recentSellVolume?: number;
    buySellRatio?: number;
    volumeSpikeRatio?: number;
    markPrice?: number;
    indexPrice?: number;
    fundingRate?: number;
    nextFundingTime?: string;
    openInterest?: number;
    liquidationBuyQty?: number;
    liquidationSellQty?: number;
    liquidationBuyNotional?: number;
    liquidationSellNotional?: number;
    liquidationImbalance?: number;
    newsSentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
    macroHighImpactNews: boolean;
    macroUncertaintyLevel: number;
  };
  raw: {
    ticker?: unknown;
    orderBook?: unknown;
    recentTrades?: unknown;
    klines?: unknown;
    futures?: unknown;
    news?: unknown;
    errors?: string[];
  };
};

function finite(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function round(value: number | undefined, digits = 6) {
  return value === undefined ? undefined : Number(value.toFixed(digits));
}

function computeOrderBook(orderBook?: OrderBookSnapshot) {
  if (!orderBook) return {};
  const bidDepth = orderBook.bids.reduce((acc, row) => acc + row.price * row.quantity, 0);
  const askDepth = orderBook.asks.reduce((acc, row) => acc + row.price * row.quantity, 0);
  const bestBid = orderBook.bids[0]?.price;
  const bestAsk = orderBook.asks[0]?.price;
  const spreadPercent = bestBid && bestAsk ? ((bestAsk - bestBid) / Math.max(bestAsk, 0.0001)) * 100 : undefined;
  const imbalance = (bidDepth - askDepth) / Math.max(bidDepth + askDepth, 0.0001);
  return {
    bidDepth: round(bidDepth, 2),
    askDepth: round(askDepth, 2),
    bestBid: round(bestBid, 8),
    bestAsk: round(bestAsk, 8),
    spreadPercent: round(spreadPercent, 4),
    imbalance: round(imbalance, 6),
  };
}

function computeRecentTrades(trades?: RecentTrade[]) {
  if (!trades) return {};
  const buyVolume = trades
    .filter((row) => !row.isBuyerMaker)
    .reduce((acc, row) => acc + row.qty * row.price, 0);
  const sellVolume = trades
    .filter((row) => row.isBuyerMaker)
    .reduce((acc, row) => acc + row.qty * row.price, 0);
  return {
    buyVolume: round(buyVolume, 2),
    sellVolume: round(sellVolume, 2),
    buySellRatio: round(buyVolume / Math.max(sellVolume, 0.0001), 6),
  };
}

function computeVolumeSpike(klines?: KlineItem[]) {
  if (!klines || klines.length < 8) return undefined;
  const recent = klines.slice(-22);
  const last = recent[recent.length - 1]?.volume ?? 0;
  const baseline = recent.slice(0, -1).reduce((acc, row) => acc + row.volume, 0) / Math.max(recent.length - 1, 1);
  return baseline > 0 ? round(last / baseline, 6) : undefined;
}

async function fetchJson(url: string, timeoutMs = Math.max(3000, env.BINANCE_TIMEOUT_MS)) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

type LiquidationStats = {
  buyQty: number;
  sellQty: number;
  buyNotional: number;
  sellNotional: number;
};

async function collectFuturesEvidence(futuresSymbol: string) {
  const base = env.BINANCE_GLOBAL_HTTP_BASE.replace("api.binance.com", "fapi.binance.com").replace(/\/$/, "");
  const query = encodeURIComponent(futuresSymbol);
  const [premium, openInterest, funding, liquidations] = await Promise.allSettled([
    fetchJson(`${base}/fapi/v1/premiumIndex?symbol=${query}`),
    fetchJson(`${base}/fapi/v1/openInterest?symbol=${query}`),
    fetchJson(`${base}/fapi/v1/fundingRate?symbol=${query}&limit=8`),
    fetchJson(`${base}/fapi/v1/allForceOrders?symbol=${query}&limit=50`),
  ]);
  const premiumRow = premium.status === "fulfilled" ? premium.value as Record<string, unknown> : {};
  const oiRow = openInterest.status === "fulfilled" ? openInterest.value as Record<string, unknown> : {};
  const liquidationRows = liquidations.status === "fulfilled" && Array.isArray(liquidations.value)
    ? liquidations.value as Array<Record<string, unknown>>
    : [];
  const liquidationStats = liquidationRows.reduce<LiquidationStats>(
    (acc, row) => {
      const qty = finite(row.origQty ?? row.executedQty) ?? 0;
      const price = finite(row.averagePrice ?? row.price) ?? 0;
      const notional = qty * price;
      const side = String(row.side ?? "").toUpperCase();
      if (side === "BUY") {
        acc.buyQty += qty;
        acc.buyNotional += notional;
      } else if (side === "SELL") {
        acc.sellQty += qty;
        acc.sellNotional += notional;
      }
      return acc;
    },
    { buyQty: 0, sellQty: 0, buyNotional: 0, sellNotional: 0 },
  );
  const liquidationImbalance =
    (liquidationStats.buyNotional - liquidationStats.sellNotional) /
    Math.max(liquidationStats.buyNotional + liquidationStats.sellNotional, 0.0001);
  return {
    summary: {
      markPrice: finite(premiumRow.markPrice),
      indexPrice: finite(premiumRow.indexPrice),
      fundingRate: finite(premiumRow.lastFundingRate),
      nextFundingTime: finite(premiumRow.nextFundingTime)
        ? new Date(Number(premiumRow.nextFundingTime)).toISOString()
        : undefined,
      openInterest: finite(oiRow.openInterest),
      liquidationBuyQty: round(liquidationStats.buyQty, 6),
      liquidationSellQty: round(liquidationStats.sellQty, 6),
      liquidationBuyNotional: round(liquidationStats.buyNotional, 2),
      liquidationSellNotional: round(liquidationStats.sellNotional, 2),
      liquidationImbalance: round(liquidationImbalance, 6),
    },
    raw: {
      premium: premium.status === "fulfilled" ? premium.value : { error: premium.reason instanceof Error ? premium.reason.message : "premium failed" },
      openInterest: openInterest.status === "fulfilled" ? openInterest.value : { error: openInterest.reason instanceof Error ? openInterest.reason.message : "open interest failed" },
      funding: funding.status === "fulfilled" ? funding.value : { error: funding.reason instanceof Error ? funding.reason.message : "funding failed" },
      liquidations: liquidations.status === "fulfilled" ? liquidations.value : { error: liquidations.reason instanceof Error ? liquidations.reason.message : "liquidations failed" },
    },
  };
}

async function collectNewsEvidence() {
  const macro = {
    newsSentiment: env.MACRO_NEWS_SENTIMENT,
    macroHighImpactNews: env.MACRO_HIGH_IMPACT_NEWS,
    macroUncertaintyLevel: env.MACRO_UNCERTAINTY_LEVEL,
  };
  try {
    const raw = await fetchJson("https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageSize=10&pageNo=1", 3500);
    return { summary: macro, raw: { macro, binanceAnnouncements: raw } };
  } catch (error) {
    return {
      summary: macro,
      raw: { macro, error: error instanceof Error ? error.message : "news fetch failed" },
    };
  }
}

export async function collectLearningMarketEvidence(symbol: string): Promise<LearningMarketEvidenceSnapshot> {
  const futuresSymbol = toGlobalLeverageSymbol(symbol);
  const capturedAt = new Date().toISOString();
  const [ticker, orderBook, recentTrades, klines, futures, news] = await Promise.allSettled([
    getTicker(symbol),
    getOrderBook(symbol, 100),
    getRecentTrades(symbol, 120),
    getKlines(symbol, "1m", 120),
    collectFuturesEvidence(futuresSymbol),
    collectNewsEvidence(),
  ]);
  const errors = [ticker, orderBook, recentTrades, klines, futures, news]
    .flatMap((row) => row.status === "rejected" ? [row.reason instanceof Error ? row.reason.message : String(row.reason)] : []);
  const tickerValue = ticker.status === "fulfilled" ? ticker.value : undefined;
  const orderBookValue = orderBook.status === "fulfilled" ? orderBook.value : undefined;
  const recentTradesValue = recentTrades.status === "fulfilled" ? recentTrades.value : undefined;
  const klinesValue = klines.status === "fulfilled" ? klines.value : undefined;
  const futuresValue = futures.status === "fulfilled" ? futures.value : undefined;
  const newsValue = news.status === "fulfilled" ? news.value : {
    summary: {
      newsSentiment: env.MACRO_NEWS_SENTIMENT,
      macroHighImpactNews: env.MACRO_HIGH_IMPACT_NEWS,
      macroUncertaintyLevel: env.MACRO_UNCERTAINTY_LEVEL,
    },
    raw: {},
  };
  const book = computeOrderBook(orderBookValue);
  const flow = computeRecentTrades(recentTradesValue);
  return {
    symbol: tickerValue?.symbol ?? symbol.toUpperCase(),
    futuresSymbol,
    capturedAt,
    summary: {
      spotLastPrice: tickerValue?.price,
      spotBidPrice: book.bestBid,
      spotAskPrice: book.bestAsk,
      spotSpreadPercent: book.spreadPercent,
      spotVolume24h: tickerValue?.volume24h,
      orderBookBidDepth: book.bidDepth,
      orderBookAskDepth: book.askDepth,
      orderBookImbalance: book.imbalance,
      recentBuyVolume: flow.buyVolume,
      recentSellVolume: flow.sellVolume,
      buySellRatio: flow.buySellRatio,
      volumeSpikeRatio: computeVolumeSpike(klinesValue),
      ...futuresValue?.summary,
      newsSentiment: newsValue.summary.newsSentiment,
      macroHighImpactNews: newsValue.summary.macroHighImpactNews,
      macroUncertaintyLevel: newsValue.summary.macroUncertaintyLevel,
    },
    raw: {
      ticker: tickerValue,
      orderBook: orderBookValue,
      recentTrades: recentTradesValue,
      klines: klinesValue,
      futures: futuresValue?.raw,
      news: newsValue.raw,
      errors,
    },
  };
}
