export function shouldBindSymbolOnTerminalFail(reason: string, symbol?: string) {
  if (!symbol) return undefined;
  const upper = reason.toUpperCase();
  if (
    upper.includes("NO_TRADE") ||
    upper.includes("NO TRADE") ||
    upper.includes("NON_EXECUTABLE") ||
    upper.includes("NO_CANDIDATE") ||
    upper.includes("UYGUN COIN")
  ) {
    return undefined;
  }
  return symbol;
}
