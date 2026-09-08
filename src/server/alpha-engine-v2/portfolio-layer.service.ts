import type { AlphaSignal, PortfolioDecision } from "./types";

export type PortfolioConfig = {
  maxPositions: number;
  maxPerSymbol: number;
  capital: number;
  notionalPerTrade: number;
};

export function selectPortfolioSignals(
  signals: AlphaSignal[],
  config: PortfolioConfig,
): PortfolioDecision[] {
  const acceptedSymbols = new Set<string>();
  const decisions: PortfolioDecision[] = [];
  const ranked = [...signals]
    .filter((s) => s.side !== "CASH")
    .sort((a, b) => b.expectedNetEdgeBps - a.expectedNetEdgeBps);

  for (const signal of ranked) {
    if (acceptedSymbols.size >= config.maxPositions) {
      decisions.push({
        accepted: false,
        symbol: signal.symbol,
        side: signal.side,
        alphaId: signal.alphaId,
        notional: 0,
        reasonCodes: ["MAX_POSITIONS"],
        rejectedBecause: "MAX_POSITIONS",
      });
      continue;
    }
    const symbolCount = [...acceptedSymbols].filter((s) => s === signal.symbol).length;
    if (symbolCount >= config.maxPerSymbol) {
      decisions.push({
        accepted: false,
        symbol: signal.symbol,
        side: signal.side,
        alphaId: signal.alphaId,
        notional: 0,
        reasonCodes: ["DUPLICATE_SYMBOL"],
        rejectedBecause: "DUPLICATE_SYMBOL",
      });
      continue;
    }
    acceptedSymbols.add(signal.symbol);
    decisions.push({
      accepted: true,
      symbol: signal.symbol,
      side: signal.side,
      alphaId: signal.alphaId,
      notional: config.notionalPerTrade,
      reasonCodes: ["PORTFOLIO_ACCEPT"],
    });
  }
  return decisions;
}
