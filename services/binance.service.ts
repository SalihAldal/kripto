import type { MarketTicker } from "@/lib/types";
import { env } from "@/lib/config";
import { getExchangeAdapter, getExchangeProvider } from "@/src/server/exchange";
import { ExternalServiceError } from "@/src/server/errors";
import { markHeartbeat } from "@/src/server/observability/heartbeat";
import { withCircuitBreaker } from "@/src/server/resilience/circuit-breaker";
import type { ExchangeBalance, FeeEstimate, KlineItem, OrderBookSnapshot, PlaceOrderResult, RecentTrade } from "@/src/types/exchange";
import { pushLog } from "@/services/log.service";

let tradableSymbolSetCache: Set<string> | null = null;
let tradableSymbolSetCacheAt = 0;
let tradableSymbolSetFailureUntil = 0;

function isTransientExchangeInfoError(error: unknown) {
  const message = (error as Error)?.message?.toLowerCase?.() ?? "";
  return (
    message.includes("exchangeinfo") ||
    message.includes("http 429") ||
    message.includes("too many requests") ||
    message.includes("read econnreset") ||
    message.includes("aborted") ||
    message.includes("cooldown active until") ||
    message.includes("circuit is open for exchange:getexchangeinfo")
  );
}

function isBusinessOrderRejectError(error: unknown) {
  const message = (error as Error)?.message?.toLowerCase?.() ?? "";
  return (
    message.includes("code=3210") ||
    message.includes("total volume is too low") ||
    message.includes("notional below min") ||
    message.includes("order validation failed")
  );
}

function candidateSymbolVariants(symbol: string) {
  const normalized = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const variants = new Set<string>();
  if (env.BINANCE_PLATFORM === "tr") {
    // Binance TR tarafinda ayni coinin TRY ve USDT marketi bir arada varsa
    // TRY marketini onceleyelim ki bakiye/sizing TRY ile tutarli olsun.
    if (normalized.endsWith("USDT")) {
      variants.add(`${normalized.slice(0, -4)}TRY`);
      variants.add(normalized);
      return Array.from(variants);
    }
    if (normalized.endsWith("TRY")) {
      variants.add(normalized);
      return Array.from(variants);
    }
    variants.add(`${normalized}TRY`);
    return Array.from(variants);
  }
  variants.add(normalized);
  if (normalized.endsWith("USDT")) variants.add(`${normalized.slice(0, -4)}TRY`);
  if (normalized.endsWith("TRY")) variants.add(`${normalized.slice(0, -3)}USDT`);
  return Array.from(variants);
}

async function getTradableSymbolSet() {
  const now = Date.now();
  if (tradableSymbolSetCache && now - tradableSymbolSetCacheAt < 60_000) {
    return tradableSymbolSetCache;
  }
  const info = await getExchangeInfo();
  tradableSymbolSetCache = new Set(info.symbols.map((row) => row.symbol.toUpperCase()));
  tradableSymbolSetCacheAt = now;
  return tradableSymbolSetCache;
}

async function resolveSymbolForExchange(symbol: string) {
  const normalized = symbol.toUpperCase();
  const preferredVariants = candidateSymbolVariants(normalized);
  if (Date.now() < tradableSymbolSetFailureUntil) {
    return preferredVariants[0] ?? normalized;
  }
  try {
    const tradable = await getTradableSymbolSet();
    for (const candidate of preferredVariants) {
      if (tradable.has(candidate)) return candidate;
    }
  } catch {
    // If exchange info fetch fails, avoid hammering exchangeInfo repeatedly
    // and prefer deterministic TR-first variant mapping.
    tradableSymbolSetFailureUntil = Date.now() + 20_000;
    return preferredVariants[0] ?? normalized;
  }
  return preferredVariants[0] ?? normalized;
}

export async function resolveExchangeSymbol(symbol: string) {
  return resolveSymbolForExchange(symbol);
}

export async function getTicker(symbol: string): Promise<MarketTicker> {
  const provider = getExchangeProvider();
  const normalized = await resolveSymbolForExchange(symbol);
  try {
    const row = await withCircuitBreaker(
      "exchange:getTicker",
      () => provider.getTicker(normalized),
      { threshold: 5, cooldownMs: 15_000 },
    );
    markHeartbeat({ service: "exchange", status: "UP", message: "Ticker fetched", details: { symbol: normalized } });
    return {
      symbol: row.symbol,
      price: row.price,
      change24h: row.change24h,
      volume24h: row.volume24h,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    pushLog("ERROR", `Ticker fetch failed: ${(error as Error).message}`);
    markHeartbeat({ service: "exchange", status: "DEGRADED", message: "Ticker fetch failed" });
    throw new ExternalServiceError((error as Error).message, { symbol: normalized });
  }
}

export async function scanWatchlist(symbols: string[]) {
  const result = await Promise.all(symbols.map((symbol) => getTicker(symbol)));
  pushLog("INFO", `Coin tarama tamamlandi (${symbols.length} adet).`);
  return result.sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h));
}

export async function getKlines(symbol: string, interval = "1m", limit = 100): Promise<KlineItem[]> {
  const provider = getExchangeProvider();
  const normalized = await resolveSymbolForExchange(symbol);
  const rows = await withCircuitBreaker(
    "exchange:getKlines",
    () => provider.getKlines(normalized, interval, limit),
    { threshold: 5, cooldownMs: 15_000 },
  );
  pushLog("INFO", `${normalized} klines cekildi (${interval}, ${limit})`);
  return rows;
}

export async function getOrderBook(symbol: string, limit = 50): Promise<OrderBookSnapshot> {
  const provider = getExchangeProvider();
  const normalized = await resolveSymbolForExchange(symbol);
  const orderBook = await withCircuitBreaker(
    "exchange:getOrderBook",
    () => provider.getOrderBook(normalized, limit),
    { threshold: 5, cooldownMs: 15_000 },
  );
  pushLog("INFO", `${normalized} orderbook cekildi`);
  return orderBook;
}

export async function getRecentTrades(symbol: string, limit = 50): Promise<RecentTrade[]> {
  const provider = getExchangeProvider();
  const normalized = await resolveSymbolForExchange(symbol);
  const rows = await withCircuitBreaker(
    "exchange:getRecentTrades",
    () => provider.getRecentTrades(normalized, limit),
    { threshold: 5, cooldownMs: 15_000 },
  );
  pushLog("INFO", `${normalized} recent trades cekildi`);
  return rows;
}

export async function placeMarketBuy(symbol: string, quantity: number, dryRun?: boolean): Promise<PlaceOrderResult> {
  const adapter = getExchangeAdapter();
  const normalized = await resolveSymbolForExchange(symbol);
  // Do not route order-business rejects (e.g. min notional) into circuit-open state.
  const result = await adapter.placeBuyOrder({
    symbol: normalized,
    quantity,
    type: "MARKET",
    dryRun,
  }).catch((error) => {
    if (isBusinessOrderRejectError(error)) {
      throw new ExternalServiceError((error as Error).message, { symbol: normalized, quantity, side: "BUY" });
    }
    return withCircuitBreaker(
      "exchange:placeMarketBuy",
      () =>
        adapter.placeBuyOrder({
          symbol: normalized,
          quantity,
          type: "MARKET",
          dryRun,
        }),
      { threshold: 3, cooldownMs: 20_000 },
    ).catch((inner) => {
      throw new ExternalServiceError((inner as Error).message, { symbol: normalized, quantity, side: "BUY" });
    });
  });
  pushLog("TRADE", `${normalized} market BUY ${quantity} => ${result.status}`);
  return {
    orderId: result.orderId,
    symbol: result.symbol,
    side: result.side,
    type: result.type,
    status: result.status,
    executedQty: result.executedQty,
    price: result.price,
    dryRun: Boolean(dryRun),
    metadata: result.raw,
  };
}

export async function placeMarketBuyByQuote(symbol: string, quoteOrderQty: number, dryRun?: boolean): Promise<PlaceOrderResult> {
  const adapter = getExchangeAdapter();
  const normalized = await resolveSymbolForExchange(symbol);
  const place = () =>
    adapter.placeBuyOrder({
      symbol: normalized,
      type: "MARKET",
      quoteOrderQty,
      quantity: quoteOrderQty,
      dryRun,
    });
  const result = await place().catch((error) => {
    if (isBusinessOrderRejectError(error)) {
      throw new ExternalServiceError((error as Error).message, { symbol: normalized, quoteOrderQty, side: "BUY" });
    }
    return withCircuitBreaker(
      "exchange:placeMarketBuy",
      place,
      { threshold: 3, cooldownMs: 20_000 },
    ).catch((inner) => {
      throw new ExternalServiceError((inner as Error).message, { symbol: normalized, quoteOrderQty, side: "BUY" });
    });
  });
  pushLog("TRADE", `${normalized} market BUY quote=${quoteOrderQty} => ${result.status}`);
  return {
    orderId: result.orderId,
    symbol: result.symbol,
    side: result.side,
    type: result.type,
    status: result.status,
    executedQty: result.executedQty,
    price: result.price,
    dryRun: Boolean(dryRun),
    metadata: result.raw,
  };
}

export async function placeMarketSell(symbol: string, quantity: number, dryRun?: boolean): Promise<PlaceOrderResult> {
  const adapter = getExchangeAdapter();
  const normalized = await resolveSymbolForExchange(symbol);
  // Do not route order-business rejects (e.g. min notional) into circuit-open state.
  const result = await adapter.placeSellOrder({
    symbol: normalized,
    quantity,
    type: "MARKET",
    dryRun,
  }).catch((error) => {
    if (isBusinessOrderRejectError(error)) {
      throw new ExternalServiceError((error as Error).message, { symbol: normalized, quantity, side: "SELL" });
    }
    return withCircuitBreaker(
      "exchange:placeMarketSell",
      () =>
        adapter.placeSellOrder({
          symbol: normalized,
          quantity,
          type: "MARKET",
          dryRun,
        }),
      { threshold: 3, cooldownMs: 20_000 },
    ).catch((inner) => {
      throw new ExternalServiceError((inner as Error).message, { symbol: normalized, quantity, side: "SELL" });
    });
  });
  pushLog("TRADE", `${normalized} market SELL ${quantity} => ${result.status}`);
  return {
    orderId: result.orderId,
    symbol: result.symbol,
    side: result.side,
    type: result.type,
    status: result.status,
    executedQty: result.executedQty,
    price: result.price,
    dryRun: Boolean(dryRun),
    metadata: result.raw,
  };
}

export async function placeMarketBuyEmergency(symbol: string, quantity: number, dryRun?: boolean): Promise<PlaceOrderResult> {
  const provider = getExchangeProvider();
  const normalized = await resolveSymbolForExchange(symbol);
  try {
    const result = await provider.placeMarketBuy(normalized, quantity, dryRun);
    pushLog("WARN", `${normalized} emergency market BUY ${quantity} => ${result.status}`);
    return result;
  } catch (error) {
    throw new ExternalServiceError((error as Error).message, {
      symbol: normalized,
      quantity,
      side: "BUY",
      emergencyClose: true,
    });
  }
}

export async function placeMarketSellEmergency(symbol: string, quantity: number, dryRun?: boolean): Promise<PlaceOrderResult> {
  const provider = getExchangeProvider();
  const normalized = await resolveSymbolForExchange(symbol);
  try {
    const result = await provider.placeMarketSell(normalized, quantity, dryRun);
    pushLog("WARN", `${normalized} emergency market SELL ${quantity} => ${result.status}`);
    return result;
  } catch (error) {
    throw new ExternalServiceError((error as Error).message, {
      symbol: normalized,
      quantity,
      side: "SELL",
      emergencyClose: true,
    });
  }
}

export async function placeLimitBuy(
  symbol: string,
  quantity: number,
  price: number,
  dryRun?: boolean,
): Promise<PlaceOrderResult> {
  const adapter = getExchangeAdapter();
  const normalized = await resolveSymbolForExchange(symbol);
  const result = await adapter.placeBuyOrder({
    symbol: normalized,
    quantity,
    type: "LIMIT",
    price,
    dryRun,
  });
  pushLog("TRADE", `${normalized} limit BUY ${quantity}@${price} => ${result.status}`);
  return {
    orderId: result.orderId,
    symbol: result.symbol,
    side: result.side,
    type: result.type,
    status: result.status,
    executedQty: result.executedQty,
    price: result.price,
    dryRun: Boolean(dryRun),
    metadata: result.raw,
  };
}

export async function placeLimitSell(
  symbol: string,
  quantity: number,
  price: number,
  dryRun?: boolean,
): Promise<PlaceOrderResult> {
  const adapter = getExchangeAdapter();
  const normalized = await resolveSymbolForExchange(symbol);
  const result = await adapter.placeSellOrder({
    symbol: normalized,
    quantity,
    type: "LIMIT",
    price,
    dryRun,
  });
  pushLog("TRADE", `${normalized} limit SELL ${quantity}@${price} => ${result.status}`);
  return {
    orderId: result.orderId,
    symbol: result.symbol,
    side: result.side,
    type: result.type,
    status: result.status,
    executedQty: result.executedQty,
    price: result.price,
    dryRun: Boolean(dryRun),
    metadata: result.raw,
  };
}

export async function cancelOrder(symbol: string, orderId: string) {
  const adapter = getExchangeAdapter();
  const normalized = await resolveSymbolForExchange(symbol);
  const result = await adapter.cancelOrder(normalized, orderId);
  pushLog("TRADE", `${normalized} cancel order ${orderId} => ${result.status}`);
  return result;
}

export async function getOrderStatus(symbol: string, orderId: string) {
  const adapter = getExchangeAdapter();
  const normalized = await resolveSymbolForExchange(symbol);
  const row = await adapter.getOrderStatus(normalized, orderId);
  return {
    orderId: row.orderId,
    symbol: row.symbol,
    status: row.status,
    side: row.side,
    type: row.type,
    executedQty: row.executedQty,
    price: row.price,
    raw: row.raw,
  };
}

export async function getExchangeInfo() {
  const provider = getExchangeProvider();
  try {
    const info = await withCircuitBreaker(
      "exchange:getExchangeInfo",
      () => provider.getExchangeInfo(),
      { threshold: 4, cooldownMs: 15_000 },
    );
    markHeartbeat({ service: "exchange", status: "UP", message: "Exchange info fetched" });
    return info;
  } catch (error) {
    pushLog("ERROR", `Exchange info fetch failed: ${(error as Error).message}`);
    markHeartbeat({ service: "exchange", status: "DEGRADED", message: "Exchange info fetch failed" });
    throw new ExternalServiceError((error as Error).message);
  }
}

function isLeveragedTokenSymbol(symbol: string) {
  return symbol.includes("UPUSDT") || symbol.includes("DOWNUSDT") || symbol.includes("BULLUSDT") || symbol.includes("BEARUSDT");
}

export async function listTradableSymbols(maxSymbols = 1200, quoteAsset?: string) {
  const info = await getExchangeInfo();
  const symbols = info.symbols
    .filter((row) => row.status === "TRADING")
    .filter((row) => (quoteAsset ? row.quoteAsset === quoteAsset : true))
    .map((row) => row.symbol.toUpperCase())
    .filter((symbol) => !isLeveragedTokenSymbol(symbol));
  return Array.from(new Set(symbols)).slice(0, maxSymbols);
}

export async function listTradableUsdtSymbols(maxSymbols = 1200) {
  const symbols = await listTradableSymbols(maxSymbols, "USDT");
  return Array.from(new Set(symbols)).slice(0, maxSymbols);
}

export async function validateSymbolFilters(symbol: string, quantity: number, price?: number) {
  const adapter = getExchangeAdapter();
  const normalized = await resolveSymbolForExchange(symbol);
  try {
    const normalizedResult = await adapter.normalizeFiltersAndPrecision(normalized, quantity, price);
    return {
      ok: normalizedResult.validationPassed,
      reasons: normalizedResult.reasons,
      adjustedQuantity: normalizedResult.normalizedQuantity,
      adjustedPrice: normalizedResult.normalizedPrice,
      minNotional: normalizedResult.minNotional,
    };
  } catch (error) {
    if (isTransientExchangeInfoError(error)) {
      // Fail-open for transient exchange metadata outages; exchange will still reject invalid orders.
      return {
        ok: true,
        reasons: [],
        adjustedQuantity: Number(quantity.toFixed(8)),
        adjustedPrice: price,
      };
    }
    throw error;
  }
}

export async function calculateValidQuantity(symbol: string, quantity: number) {
  const adapter = getExchangeAdapter();
  const normalized = await resolveSymbolForExchange(symbol);
  try {
    const normalizedResult = await adapter.normalizeFiltersAndPrecision(normalized, quantity);
    return normalizedResult.normalizedQuantity;
  } catch (error) {
    if (isTransientExchangeInfoError(error)) {
      return Number(quantity.toFixed(8));
    }
    throw error;
  }
}

export async function estimateFees(
  symbol: string,
  side: "BUY" | "SELL",
  quantity: number,
  price: number,
): Promise<FeeEstimate> {
  const adapter = getExchangeAdapter();
  const normalized = await resolveSymbolForExchange(symbol);
  return adapter.estimateFees(normalized, side, quantity, price);
}

export async function getAccountBalances(): Promise<ExchangeBalance[]> {
  const adapter = getExchangeAdapter();
  try {
    const rows = await withCircuitBreaker(
      "exchange:getAccountBalances",
      () => adapter.getBalances(),
      { threshold: 3, cooldownMs: 20_000 },
    );
    markHeartbeat({ service: "exchange", status: "UP", message: "Account balances fetched" });
    return rows;
  } catch (error) {
    pushLog("ERROR", `Account balances fallback: ${(error as Error).message}`);
    markHeartbeat({ service: "exchange", status: "DEGRADED", message: "Account balances unavailable" });
    return [];
  }
}

export async function getAccountBalancesVerbose(): Promise<{
  balances: ExchangeBalance[];
  error: string | null;
}> {
  const adapter = getExchangeAdapter();
  try {
    const rows = await withCircuitBreaker(
      "exchange:getAccountBalances",
      () => adapter.getBalances(),
      { threshold: 3, cooldownMs: 20_000 },
    );
    markHeartbeat({ service: "exchange", status: "UP", message: "Account balances fetched" });
    return { balances: rows, error: null };
  } catch (error) {
    const message = (error as Error).message;
    pushLog("ERROR", `Account balances failed: ${message}`);
    markHeartbeat({ service: "exchange", status: "DEGRADED", message: "Account balances unavailable" });
    return { balances: [], error: message };
  }
}

export function subscribeTicker(symbol: string, onData: (data: { symbol: string; price: number; eventTime: number }) => void) {
  const provider = getExchangeProvider();
  return provider.subscribeTicker(symbol.toUpperCase(), onData);
}
