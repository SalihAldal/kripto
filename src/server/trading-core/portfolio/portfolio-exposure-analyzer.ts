import { clamp } from "@/src/server/trading-core/indicators/math";
import type { ExposureBucket, PortfolioPositionInput, PortfolioRiskLevel } from "@/src/server/trading-core/portfolio/portfolio-types";

function notional(position: PortfolioPositionInput) {
  return Math.abs(position.quantity * position.currentPrice);
}

function signedNotional(position: PortfolioPositionInput) {
  const value = notional(position);
  return position.side === "BUY" ? value : -value;
}

function addBucket(map: Map<string, ExposureBucket>, key: string, position: PortfolioPositionInput, accountEquity: number) {
  const gross = notional(position);
  const signed = signedNotional(position);
  const current = map.get(key) ?? { key, notionalUsd: 0, exposurePercent: 0, longNotionalUsd: 0, shortNotionalUsd: 0, netNotionalUsd: 0 };
  current.notionalUsd += gross;
  current.longNotionalUsd += position.side === "BUY" ? gross : 0;
  current.shortNotionalUsd += position.side === "SELL" ? gross : 0;
  current.netNotionalUsd += signed;
  current.exposurePercent = accountEquity > 0 ? current.notionalUsd / accountEquity * 100 : 0;
  map.set(key, current);
}

export class PortfolioExposureAnalyzer {
  symbolExposure(positions: PortfolioPositionInput[], accountEquity: number): ExposureBucket[] {
    const buckets = new Map<string, ExposureBucket>();
    for (const position of positions) addBucket(buckets, position.symbol.toUpperCase(), position, accountEquity);
    return this.sorted(buckets);
  }

  strategyExposure(positions: PortfolioPositionInput[], accountEquity: number): ExposureBucket[] {
    const buckets = new Map<string, ExposureBucket>();
    for (const position of positions) addBucket(buckets, position.strategy ?? String(position.metadata?.strategy ?? position.botId ?? "unknown"), position, accountEquity);
    return this.sorted(buckets);
  }

  totalExposure(positions: PortfolioPositionInput[], accountEquity: number) {
    const totalExposureUsd = positions.reduce((sum, position) => sum + notional(position), 0);
    return {
      totalExposureUsd: Number(totalExposureUsd.toFixed(2)),
      totalExposurePercent: Number((accountEquity > 0 ? totalExposureUsd / accountEquity * 100 : 0).toFixed(4)),
    };
  }

  riskDistribution(symbolExposure: ExposureBucket[]): Record<PortfolioRiskLevel, number> {
    return symbolExposure.reduce<Record<PortfolioRiskLevel, number>>(
      (acc, bucket) => {
        const level = this.level(bucket.exposurePercent);
        acc[level] += 1;
        return acc;
      },
      { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
    );
  }

  riskScore(symbolExposure: ExposureBucket[], strategyExposure: ExposureBucket[], totalExposurePercent: number) {
    const topSymbol = symbolExposure[0]?.exposurePercent ?? 0;
    const topStrategy = strategyExposure[0]?.exposurePercent ?? 0;
    return Number(clamp(topSymbol * 1.4 + topStrategy * 0.9 + totalExposurePercent * 0.25, 0, 100).toFixed(2));
  }

  private sorted(buckets: Map<string, ExposureBucket>) {
    return Array.from(buckets.values())
      .map((bucket) => ({
        ...bucket,
        notionalUsd: Number(bucket.notionalUsd.toFixed(2)),
        exposurePercent: Number(bucket.exposurePercent.toFixed(4)),
        longNotionalUsd: Number(bucket.longNotionalUsd.toFixed(2)),
        shortNotionalUsd: Number(bucket.shortNotionalUsd.toFixed(2)),
        netNotionalUsd: Number(bucket.netNotionalUsd.toFixed(2)),
      }))
      .sort((a, b) => b.exposurePercent - a.exposurePercent);
  }

  private level(exposurePercent: number): PortfolioRiskLevel {
    if (exposurePercent >= 45) return "CRITICAL";
    if (exposurePercent >= 28) return "HIGH";
    if (exposurePercent >= 15) return "MEDIUM";
    return "LOW";
  }
}
