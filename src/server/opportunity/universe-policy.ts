const STABLE_BASES = new Set(["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "DAI", "USD1"]);
const LEVERAGED_RE = /(UP|DOWN|BULL|BEAR)$/i;

export function isExcludedOpportunitySymbol(
  symbol: string,
  options?: { extraExcludedQuotes?: string[] },
): boolean {
  const upper = symbol.toUpperCase();
  const quotes = options?.extraExcludedQuotes ?? ["USDC", "FDUSD", "TUSD", "BUSD", "DAI"];
  for (const quote of quotes) {
    if (upper.endsWith(`${quote}USDT`) || upper === `${quote}USDT`) return true;
    if (upper.endsWith(quote) && STABLE_BASES.has(upper.slice(0, -quote.length))) return true;
  }
  const base = upper.replace(/USDT|TRY|BUSD|USDC$/i, "");
  if (LEVERAGED_RE.test(base)) return true;
  if (STABLE_BASES.has(base) && (upper.endsWith("USDT") || upper.endsWith("TRY"))) return true;
  return false;
}

export function resolveBenchmarkSymbol(symbols: string[]) {
  const set = new Set(symbols.map((s) => s.toUpperCase()));
  if (set.has("BTCUSDT")) return "BTCUSDT";
  if (set.has("BTCTRY")) return "BTCTRY";
  return symbols[0] ?? "BTCUSDT";
}
