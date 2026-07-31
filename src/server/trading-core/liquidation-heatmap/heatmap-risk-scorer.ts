import { clamp } from "@/src/server/trading-core/indicators/math";
import type {
  FundingPoint,
  HeatmapRiskLevel,
  LeverageZone,
  LiquidationCluster,
  OpenInterestPoint,
  SqueezeDirection,
  StopHuntZone,
} from "@/src/server/trading-core/liquidation-heatmap/liquidation-heatmap-types";

export class HeatmapRiskScorer {
  stopHuntZones(clusters: LiquidationCluster[]): StopHuntZone[] {
    return clusters
      .filter((cluster) => cluster.distancePercent <= 2.5 && cluster.intensityScore >= 45)
      .map((cluster) => ({
        side: cluster.side,
        price: cluster.centerPrice,
        distancePercent: cluster.distancePercent,
        notionalUsd: cluster.totalNotionalUsd,
        probabilityScore: Number(clamp(cluster.intensityScore + Math.max(0, 2.5 - cluster.distancePercent) * 12, 0, 100).toFixed(2)),
        reason: `${cluster.side} liquidation cluster close to mark price`,
      }))
      .sort((a, b) => b.probabilityScore - a.probabilityScore);
  }

  leverageZones(clusters: LiquidationCluster[]): LeverageZone[] {
    const grouped = new Map<string, LeverageZone>();
    for (const cluster of clusters) {
      const leverage = Math.max(1, Math.round(cluster.averageLeverage || 1));
      const key = `${cluster.side}:${leverage}`;
      const current = grouped.get(key) ?? { leverage, side: cluster.side, notionalUsd: 0, pressureScore: 0 };
      current.notionalUsd += cluster.totalNotionalUsd;
      current.pressureScore = Math.max(current.pressureScore, cluster.intensityScore + leverage * 1.2);
      grouped.set(key, current);
    }
    return Array.from(grouped.values())
      .map((zone) => ({ ...zone, notionalUsd: Number(zone.notionalUsd.toFixed(2)), pressureScore: Number(clamp(zone.pressureScore, 0, 100).toFixed(2)) }))
      .sort((a, b) => b.pressureScore - a.pressureScore);
  }

  openInterestSpike(points: OpenInterestPoint[] = []) {
    if (points.length < 4) return 0;
    const latest = points[points.length - 1]?.openInterestUsd ?? 0;
    const baseline = points.slice(0, -1).reduce((sum, point) => sum + point.openInterestUsd, 0) / Math.max(1, points.length - 1);
    if (baseline <= 0) return 0;
    return Number(clamp(((latest - baseline) / baseline) * 180, 0, 100).toFixed(2));
  }

  fundingExtreme(points: FundingPoint[] = []) {
    const latest = Math.abs(points[points.length - 1]?.fundingRatePercent ?? 0);
    return Number(clamp((latest / 0.12) * 100, 0, 100).toFixed(2));
  }

  squeeze(clusters: LiquidationCluster[], oiSpikeScore: number, fundingExtremeScore: number): { direction: SqueezeDirection; score: number } {
    const aboveShort = clusters.filter((cluster) => cluster.side === "SHORT");
    const belowLong = clusters.filter((cluster) => cluster.side === "LONG");
    const shortPressure = aboveShort.reduce((sum, cluster) => sum + cluster.intensityScore * Math.max(0.2, 3 - cluster.distancePercent), 0);
    const longPressure = belowLong.reduce((sum, cluster) => sum + cluster.intensityScore * Math.max(0.2, 3 - cluster.distancePercent), 0);
    const base = Math.max(shortPressure, longPressure) / 3 + oiSpikeScore * 0.25 + fundingExtremeScore * 0.15;
    const direction =
      Math.abs(shortPressure - longPressure) < 12 && base > 35 ? "BOTH" : shortPressure > longPressure ? "UP" : longPressure > shortPressure ? "DOWN" : "NONE";
    return { direction, score: Number(clamp(base, 0, 100).toFixed(2)) };
  }

  manipulationRisk(input: { stopHunts: StopHuntZone[]; oiSpikeScore: number; fundingExtremeScore: number; squeezeScore: number; volatilityPercent?: number }) {
    const stopHuntScore = input.stopHunts[0]?.probabilityScore ?? 0;
    return Number(
      clamp(
        stopHuntScore * 0.35 +
          input.oiSpikeScore * 0.22 +
          input.fundingExtremeScore * 0.18 +
          input.squeezeScore * 0.2 +
          Math.min(input.volatilityPercent ?? 0, 10) * 5,
        0,
        100,
      ).toFixed(2),
    );
  }

  riskLevel(score: number): HeatmapRiskLevel {
    if (score >= 82) return "CRITICAL";
    if (score >= 65) return "HIGH";
    if (score >= 38) return "MEDIUM";
    return "LOW";
  }
}
