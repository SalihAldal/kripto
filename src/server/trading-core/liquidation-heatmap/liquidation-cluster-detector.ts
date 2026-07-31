import type { LiquidationCluster, LiquidationLevel } from "@/src/server/trading-core/liquidation-heatmap/liquidation-heatmap-types";
import { clamp } from "@/src/server/trading-core/indicators/math";

export class LiquidationClusterDetector {
  constructor(private readonly clusterDistancePercent = 0.35) {}

  detect(levels: LiquidationLevel[], markPrice: number): LiquidationCluster[] {
    const valid = levels
      .filter((level) => Number.isFinite(level.price) && level.price > 0 && Number.isFinite(level.notionalUsd) && level.notionalUsd > 0)
      .sort((a, b) => a.price - b.price);
    const clusters: LiquidationLevel[][] = [];
    for (const level of valid) {
      const current = clusters[clusters.length - 1];
      const last = current?.[current.length - 1];
      if (!current || !last || Math.abs(level.price - last.price) / Math.max(markPrice, 1) * 100 > this.clusterDistancePercent) {
        clusters.push([level]);
      } else {
        current.push(level);
      }
    }
    return clusters.map((cluster) => this.toCluster(cluster, markPrice)).sort((a, b) => b.intensityScore - a.intensityScore);
  }

  private toCluster(levels: LiquidationLevel[], markPrice: number): LiquidationCluster {
    const totalNotionalUsd = levels.reduce((sum, level) => sum + level.notionalUsd, 0);
    const weightedPrice = levels.reduce((sum, level) => sum + level.price * level.notionalUsd, 0) / Math.max(totalNotionalUsd, 1);
    const averageLeverage =
      levels.filter((level) => level.leverage).reduce((sum, level) => sum + Number(level.leverage), 0) /
      Math.max(1, levels.filter((level) => level.leverage).length);
    const distancePercent = Math.abs(weightedPrice - markPrice) / Math.max(markPrice, 1) * 100;
    const sideNotional = levels.reduce<Record<string, number>>((acc, level) => {
      acc[level.side] = (acc[level.side] ?? 0) + level.notionalUsd;
      return acc;
    }, {});
    const side = (sideNotional.SHORT ?? 0) > (sideNotional.LONG ?? 0) ? "SHORT" : "LONG";
    const intensityScore = clamp(Math.log10(totalNotionalUsd + 1) * 12 + levels.length * 4 + Math.max(0, 8 - distancePercent) * 5, 0, 100);
    return {
      side,
      minPrice: Math.min(...levels.map((level) => level.price)),
      maxPrice: Math.max(...levels.map((level) => level.price)),
      centerPrice: Number(weightedPrice.toFixed(8)),
      distancePercent: Number(distancePercent.toFixed(4)),
      totalNotionalUsd: Number(totalNotionalUsd.toFixed(2)),
      levelCount: levels.length,
      averageLeverage: Number((Number.isFinite(averageLeverage) ? averageLeverage : 0).toFixed(2)),
      intensityScore: Number(intensityScore.toFixed(2)),
    };
  }
}
