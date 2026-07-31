import { clamp } from "@/src/server/trading-core/indicators/math";
import type { CorrelationExposure, PortfolioPositionInput } from "@/src/server/trading-core/portfolio/portfolio-types";

const correlationGroups: Record<string, string[]> = {
  majors: ["BTC", "ETH", "BNB", "SOL", "AVAX", "MATIC", "ARB", "OP"],
  memes: ["DOGE", "SHIB", "PEPE", "FLOKI"],
  layer1: ["XRP", "ADA", "DOT", "ATOM", "NEAR", "INJ"],
  stables: ["USDT", "USDC", "FDUSD"],
};

function baseAsset(symbol: string) {
  return symbol.toUpperCase().replace(/(USDT|USDC|FDUSD|TRY|BTC|ETH)$/u, "");
}

export class PortfolioCorrelationAnalyzer {
  analyze(positions: PortfolioPositionInput[], accountEquity: number): CorrelationExposure[] {
    const groups = new Map<string, { symbols: Set<string>; notionalUsd: number }>();
    for (const position of positions) {
      const base = baseAsset(position.symbol);
      const group = Object.entries(correlationGroups).find(([, assets]) => assets.includes(base))?.[0] ?? `single:${base}`;
      const current = groups.get(group) ?? { symbols: new Set<string>(), notionalUsd: 0 };
      current.symbols.add(position.symbol.toUpperCase());
      current.notionalUsd += Math.abs(position.quantity * position.currentPrice);
      groups.set(group, current);
    }
    return Array.from(groups.entries())
      .map(([group, value]) => {
        const exposurePercent = accountEquity > 0 ? value.notionalUsd / accountEquity * 100 : 0;
        return {
          group,
          symbols: Array.from(value.symbols),
          notionalUsd: Number(value.notionalUsd.toFixed(2)),
          exposurePercent: Number(exposurePercent.toFixed(4)),
          riskScore: Number(clamp(exposurePercent * 1.7 + value.symbols.size * 5, 0, 100).toFixed(2)),
        };
      })
      .sort((a, b) => b.riskScore - a.riskScore);
  }
}
