export type TradeableSymbol = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
};

const LEVERAGED_RE = /(UP|DOWN|BULL|BEAR)$/;
const STABLE_BASES = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI", "USD1"]);

export function isLeveragedToken(symbol: string) {
  return LEVERAGED_RE.test(symbol.replace(/USDT|TRY|BUSD|USDC$/i, ""));
}

export function filterTradeableUniverse(
  symbols: Array<{ symbol: string; status?: string; baseAsset?: string; quoteAsset?: string }>,
  options?: {
    quoteAssets?: string[];
    excludeLeveraged?: boolean;
    excludeStableBase?: boolean;
  },
): TradeableSymbol[] {
  const quotes = new Set((options?.quoteAssets ?? ["USDT"]).map((q) => q.toUpperCase()));
  const excludeLeveraged = options?.excludeLeveraged !== false;
  const excludeStableBase = options?.excludeStableBase !== false;
  const out: TradeableSymbol[] = [];
  for (const row of symbols) {
    const symbol = String(row.symbol ?? "").toUpperCase();
    const status = String(row.status ?? "TRADING").toUpperCase();
    const baseAsset = String(row.baseAsset ?? "").toUpperCase();
    const quoteAsset = String(row.quoteAsset ?? inferQuote(symbol, quotes)).toUpperCase();
    if (!symbol || status !== "TRADING") continue;
    if (!quotes.has(quoteAsset)) continue;
    if (excludeLeveraged && (isLeveragedToken(symbol) || isLeveragedToken(baseAsset))) continue;
    if (excludeStableBase && STABLE_BASES.has(baseAsset)) continue;
    out.push({ symbol, baseAsset, quoteAsset, status });
  }
  return out;
}

function inferQuote(symbol: string, quotes: Set<string>) {
  for (const quote of quotes) {
    if (symbol.endsWith(quote)) return quote;
  }
  return "";
}

export function resolveQuoteAssets(platform: "global" | "tr", override?: string) {
  if (override && override.trim()) {
    return override
      .split(",")
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean);
  }
  return platform === "tr" ? ["TRY", "USDT"] : ["USDT"];
}
