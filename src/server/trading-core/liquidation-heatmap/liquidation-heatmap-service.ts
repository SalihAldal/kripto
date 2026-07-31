import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import { HeatmapRiskScorer } from "@/src/server/trading-core/liquidation-heatmap/heatmap-risk-scorer";
import { LiquidationClusterDetector } from "@/src/server/trading-core/liquidation-heatmap/liquidation-cluster-detector";
import type { LiquidationHeatmapAnalysis, LiquidationHeatmapInput } from "@/src/server/trading-core/liquidation-heatmap/liquidation-heatmap-types";

export class LiquidationHeatmapService {
  private readonly clusters = new LiquidationClusterDetector();
  private readonly scorer = new HeatmapRiskScorer();
  private lastAnalysis: LiquidationHeatmapAnalysis | null = null;

  analyze(input: LiquidationHeatmapInput): LiquidationHeatmapAnalysis {
    const clusters = this.clusters.detect(input.liquidationLevels, input.markPrice);
    const stopHuntZones = this.scorer.stopHuntZones(clusters);
    const leverageZones = this.scorer.leverageZones(clusters);
    const openInterestSpikeScore = this.scorer.openInterestSpike(input.openInterest);
    const fundingExtremeScore = this.scorer.fundingExtreme(input.fundingRates);
    const squeeze = this.scorer.squeeze(clusters, openInterestSpikeScore, fundingExtremeScore);
    const manipulationRiskScore = this.scorer.manipulationRisk({
      stopHunts: stopHuntZones,
      oiSpikeScore: openInterestSpikeScore,
      fundingExtremeScore,
      squeezeScore: squeeze.score,
      volatilityPercent: input.volatilityPercent,
    });
    const riskLevel = this.scorer.riskLevel(manipulationRiskScore);
    const highRiskAreas = [
      ...stopHuntZones.slice(0, 3).map((zone) => `${zone.side} stop-hunt zone around ${zone.price} (${zone.probabilityScore})`),
      ...clusters.filter((cluster) => cluster.intensityScore >= 75).slice(0, 3).map((cluster) => `${cluster.side} liquidation cluster ${cluster.minPrice}-${cluster.maxPrice}`),
    ];
    const warnings = [
      squeeze.score >= 65 ? `Possible ${squeeze.direction} squeeze detected` : null,
      openInterestSpikeScore >= 65 ? "Open interest spike detected" : null,
      fundingExtremeScore >= 65 ? "Funding extreme detected" : null,
      manipulationRiskScore >= 65 ? "High manipulation risk area" : null,
    ].filter((item): item is string => Boolean(item));

    const analysis: LiquidationHeatmapAnalysis = {
      symbol: input.symbol.toUpperCase(),
      markPrice: input.markPrice,
      clusters,
      stopHuntZones,
      leverageZones,
      openInterestSpikeScore,
      fundingExtremeScore,
      squeezeDirection: squeeze.direction,
      squeezeScore: squeeze.score,
      manipulationRiskScore,
      riskLevel,
      highRiskAreas,
      warnings,
      analyzedAt: new Date().toISOString(),
    };
    this.lastAnalysis = analysis;
    if (riskLevel === "HIGH" || riskLevel === "CRITICAL") {
      tradingLogger.warn({
        category: "RISK",
        source: "trading-core.liquidation-heatmap",
        message: `Liquidation heatmap high-risk area: ${analysis.symbol}`,
        status: "FAILED",
        symbol: analysis.symbol,
        metricName: "liquidation.manipulation_risk",
        metricValue: manipulationRiskScore,
        context: { riskLevel, squeezeDirection: squeeze.direction, warnings },
      });
    }
    return analysis;
  }

  status() {
    return {
      lastAnalysis: this.lastAnalysis,
      updatedAt: new Date().toISOString(),
    };
  }
}

const globalHeatmap = globalThis as typeof globalThis & { __liquidationHeatmapService?: LiquidationHeatmapService };
export const liquidationHeatmapService = globalHeatmap.__liquidationHeatmapService ?? new LiquidationHeatmapService();
globalHeatmap.__liquidationHeatmapService = liquidationHeatmapService;
