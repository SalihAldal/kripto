import Binance from "binance-api-node";
import { env } from "@/lib/config";

type BinanceCtor = ReturnType<typeof Binance>;

let globalClient: BinanceCtor | null = null;
let exchangeInfoCache: Awaited<ReturnType<BinanceCtor["exchangeInfo"]>> | null = null;
let exchangeInfoAt = 0;

function getGlobalClient() {
  if (!env.BINANCE_GLOBAL_API_KEY || !env.BINANCE_GLOBAL_API_SECRET) {
    throw new Error("Binance Global API key/secret eksik");
  }
  if (!globalClient) {
    globalClient = Binance({
      apiKey: env.BINANCE_GLOBAL_API_KEY,
      apiSecret: env.BINANCE_GLOBAL_API_SECRET,
      httpBase: env.BINANCE_GLOBAL_HTTP_BASE,
      wsBase: "wss://stream.binance.com:9443/ws",
    }) as BinanceCtor;
  }
  return globalClient;
}

export function isGlobalLeverageEnabled() {
  return Boolean(env.BINANCE_GLOBAL_API_KEY && env.BINANCE_GLOBAL_API_SECRET);
}

export function toGlobalLeverageSymbol(symbol: string) {
  const normalized = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized.endsWith("TRY")) return `${normalized.slice(0, -3)}USDT`;
  return normalized;
}

async function getExchangeInfoCached() {
  const now = Date.now();
  if (exchangeInfoCache && now - exchangeInfoAt < 5 * 60_000) {
    return exchangeInfoCache;
  }
  const client = getGlobalClient();
  exchangeInfoCache = await client.exchangeInfo();
  exchangeInfoAt = now;
  return exchangeInfoCache;
}

export async function getGlobalTicker(symbol: string) {
  const client = getGlobalClient();
  const raw = (await client.prices()) as unknown;
  let price = 0;
  if (Array.isArray(raw)) {
    const found = raw.find((x) => String((x as { symbol?: string }).symbol ?? "").toUpperCase() === symbol.toUpperCase()) as
      | { price?: string }
      | undefined;
    price = Number(found?.price ?? 0);
  } else {
    price = Number(((raw as Record<string, string>)[symbol] ?? 0));
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Global ticker bulunamadi: ${symbol}`);
  }
  return { symbol, price };
}

export async function calculateGlobalValidQuantity(symbol: string, quantity: number) {
  const info = (await getExchangeInfoCached()) as { symbols: Array<{ symbol: string; filters: unknown[] }> };
  const row = info.symbols.find((x: { symbol: string }) => x.symbol.toUpperCase() === symbol.toUpperCase());
  if (!row) return Number(quantity.toFixed(8));
  const filters = row.filters as Array<Record<string, unknown>>;
  const lot = filters.find((x) => String(x.filterType ?? "") === "LOT_SIZE") as
    | { minQty?: string; maxQty?: string; stepSize?: string }
    | undefined;
  const minNotional = filters.find((x) => String(x.filterType ?? "") === "MIN_NOTIONAL") as
    | { minNotional?: string }
    | undefined;
  let q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) throw new Error("Gecersiz quantity");
  if (lot) {
    const minQty = Number(lot.minQty ?? 0);
    const maxQty = Number(lot.maxQty ?? Number.MAX_SAFE_INTEGER);
    const step = Number(lot.stepSize ?? 0.00000001);
    q = Math.max(minQty, Math.min(maxQty, q));
    if (step > 0) {
      q = Math.floor(q / step) * step;
    }
  }
  const ticker = await getGlobalTicker(symbol);
  if (minNotional) {
    const minN = Number(minNotional.minNotional ?? 0);
    const notional = q * ticker.price;
    if (minN > 0 && notional < minN) {
      q = minN / ticker.price;
      if (lot?.stepSize) {
        const step = Number(lot.stepSize);
        q = Math.ceil(q / step) * step;
      }
    }
  }
  return Number(q.toFixed(8));
}

export async function placeGlobalMarketBuy(symbol: string, quantity: number, dryRun = false) {
  if (dryRun) {
    return {
      orderId: `global-dry-${Date.now()}`,
      clientOrderId: `global-dry-${Date.now()}`,
      symbol,
      status: "FILLED",
      side: "BUY" as const,
      type: "MARKET" as const,
      executedQty: quantity,
      price: 0,
      dryRun: true,
    };
  }
  const client = getGlobalClient();
  const order = await client.order({
    symbol,
    side: "BUY",
    type: "MARKET",
    quantity: String(quantity),
  } as never);
  const executedQty = Number(order.executedQty ?? quantity);
  const price = Number(order.cummulativeQuoteQty ?? 0) > 0 && executedQty > 0
    ? Number(order.cummulativeQuoteQty) / executedQty
    : 0;
  return {
    orderId: String(order.orderId ?? ""),
    clientOrderId: String(order.clientOrderId ?? ""),
    symbol,
    status: String(order.status ?? "NEW"),
    side: "BUY" as const,
    type: "MARKET" as const,
    executedQty,
    price,
    dryRun: false,
  };
}

export async function placeGlobalMarketSell(symbol: string, quantity: number, dryRun = false) {
  if (dryRun) {
    return {
      orderId: `global-dry-${Date.now()}`,
      clientOrderId: `global-dry-${Date.now()}`,
      symbol,
      status: "FILLED",
      side: "SELL" as const,
      type: "MARKET" as const,
      executedQty: quantity,
      price: 0,
      dryRun: true,
    };
  }
  const client = getGlobalClient();
  const order = await client.order({
    symbol,
    side: "SELL",
    type: "MARKET",
    quantity: String(quantity),
  } as never);
  const executedQty = Number(order.executedQty ?? quantity);
  const price = Number(order.cummulativeQuoteQty ?? 0) > 0 && executedQty > 0
    ? Number(order.cummulativeQuoteQty) / executedQty
    : 0;
  return {
    orderId: String(order.orderId ?? ""),
    clientOrderId: String(order.clientOrderId ?? ""),
    symbol,
    status: String(order.status ?? "NEW"),
    side: "SELL" as const,
    type: "MARKET" as const,
    executedQty,
    price,
    dryRun: false,
  };
}
