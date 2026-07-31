const correlationGroups: string[][] = [
  ["BTC", "ETH", "BNB", "SOL", "AVAX", "MATIC", "ARB", "OP"],
  ["DOGE", "SHIB", "PEPE", "FLOKI"],
  ["XRP", "ADA", "DOT", "ATOM"],
  ["USDT", "USDC", "FDUSD"],
];

function baseAsset(symbol: string) {
  return symbol.toUpperCase().replace(/(USDT|USDC|FDUSD|TRY|BTC|ETH)$/u, "");
}

export class CorrelationGuard {
  correlatedSymbols(symbol: string, openSymbols: string[]) {
    const base = baseAsset(symbol);
    const group = correlationGroups.find((items) => items.includes(base));
    if (!group) return [];
    return openSymbols.filter((openSymbol) => {
      const openBase = baseAsset(openSymbol);
      return openBase !== base && group.includes(openBase);
    });
  }
}
