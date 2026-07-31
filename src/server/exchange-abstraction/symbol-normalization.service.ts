const ALIAS_MAP: Record<string, string> = {
  XBT: "BTC",
  XBTUSD: "BTCUSD",
};

export function parseSymbolInput(raw: string): { base: string; quote: string } | null {
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!cleaned) return null;

  const aliased = ALIAS_MAP[cleaned] ?? cleaned;

  if (aliased.includes(":")) {
    const [base, quote] = aliased.split(":");
    return base && quote ? { base, quote } : null;
  }
  if (aliased.includes("-")) {
    const [base, quote] = aliased.split("-");
    return base && quote ? { base, quote: quote.replace("_", "") } : null;
  }
  if (aliased.includes("_")) {
    const [base, quote] = aliased.split("_");
    return base && quote ? { base, quote } : null;
  }
  if (aliased.includes("/")) {
    const [base, quote] = aliased.split("/");
    return base && quote ? { base, quote } : null;
  }

  const quotes = ["USDT", "USDC", "BUSD", "USD", "EUR", "BTC", "ETH", "TRY"];
  for (const quote of quotes.sort((a, b) => b.length - a.length)) {
    if (aliased.endsWith(quote) && aliased.length > quote.length) {
      return { base: aliased.slice(0, -quote.length), quote };
    }
  }
  return null;
}

export function toCanonicalSymbol(base: string, quote: string): string {
  const b = (ALIAS_MAP[base.toUpperCase()] ?? base.toUpperCase()).replace(/[^A-Z0-9]/g, "");
  const q = quote.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${b}:${q}`;
}

export function normalizeToCanonical(raw: string): string {
  const parsed = parseSymbolInput(raw);
  if (!parsed) return raw.toUpperCase();
  return toCanonicalSymbol(parsed.base, parsed.quote);
}

export function toExchangeSymbol(canonicalSymbol: string, format: "concat" | "dash" | "underscore" = "concat"): string {
  const parsed = parseSymbolInput(canonicalSymbol);
  if (!parsed) return canonicalSymbol.replace(":", "");
  const { base, quote } = parsed;
  switch (format) {
    case "dash":
      return `${base}-${quote}`;
    case "underscore":
      return `${base}_${quote}`;
    default:
      return `${base}${quote}`;
  }
}

export function fromExchangeSymbol(exchangeSymbol: string, pluginFormat: "concat" | "dash" | "underscore" = "concat"): string {
  return normalizeToCanonical(exchangeSymbol);
}
