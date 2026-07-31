import { clamp } from "@/src/server/trading-core/indicators/math";
import { MarketEdgeConditionClassifier, MarketEdgeSampleBuilder } from "@/src/server/trading-core/market-edge/market-edge-analyzers";
import type {
  EdgeConditionType,
  MarketEdgeCondition,
  MarketEdgeDiscoveryReport,
  MarketEdgeDiscoveryRequest,
  MarketEdgeSample,
  MarketInefficiency,
  StrategyCompatibility,
} from "@/src/server/trading-core/market-edge/market-edge-types";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";

const strategyPreferences: Record<string, { compatible: EdgeConditionType[]; avoid: EdgeConditionType[] }> = {
  scalping: {
    compatible: ["VOLUME_ANOMALY", "ORDERBOOK_IMBALANCE"],
    avoid: ["FAKE_BREAKOUT", "MARKET_INEFFICIENCY", "FUNDING_EXTREME"],
  },
  trend: {
    compatible: ["BREAKOUT_SUCCESS", "VOLATILITY_PATTERN"],
    avoid: ["FAKE_BREAKOUT", "ORDERBOOK_IMBALANCE"],
  },
  breakout: {
    compatible: ["BREAKOUT_SUCCESS", "VOLUME_ANOMALY", "WHALE_ACTIVITY"],
    avoid: ["FAKE_BREAKOUT", "LIQUIDATION_EVENT"],
  },
  dca: {
    compatible: ["VOLATILITY_PATTERN", "FUNDING_EXTREME"],
    avoid: ["WHALE_ACTIVITY", "MARKET_INEFFICIENCY"],
  },
  hedge: {
    compatible: ["FUNDING_EXTREME", "LIQUIDATION_EVENT", "MARKET_INEFFICIENCY"],
    avoid: [],
  },
};

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export class MarketEdgeDiscoveryEngine {
  private readonly builder = new MarketEdgeSampleBuilder();
  private readonly classifier = new MarketEdgeConditionClassifier();

  discover(request: MarketEdgeDiscoveryRequest): MarketEdgeDiscoveryReport {
    const samples = this.collectSamples(request);
    const minSamples = request.minSamples ?? 20;
    const conditionRows = this.conditions(samples, minSamples);
    const profitableConditions = conditionRows.filter((row) => row.edgeScore > 55 && row.averageReturnPercent > 0).sort((a, b) => b.edgeScore - a.edgeScore);
    const dangerousConditions = conditionRows.filter((row) => row.edgeScore < 42 || row.averageReturnPercent < 0).sort((a, b) => a.edgeScore - b.edgeScore);
    const strategies = request.strategies ?? ["scalping", "trend", "breakout", "dca", "hedge"];
    const strategyCompatibility = strategies.map((strategy) => this.strategyCompatibility(strategy, profitableConditions, dangerousConditions));
    const inefficiencies = this.inefficiencies(samples, conditionRows);
    const edgeConfidenceScore = this.edgeConfidence(profitableConditions, dangerousConditions, samples.length);
    const symbols = request.symbols ?? Array.from(new Set(samples.map((sample) => sample.symbol)));

    const report: MarketEdgeDiscoveryReport = {
      symbols,
      analyzedTrades: request.trades?.length ?? 0,
      analyzedSamples: samples.length,
      profitableConditions,
      dangerousConditions,
      strategyCompatibility,
      inefficiencies,
      edgeConfidenceScore,
      generatedAt: new Date().toISOString(),
    };

    tradingLogger.info({
      category: "AI",
      source: "trading-core.market-edge",
      message: `Market edge discovery completed for ${symbols.length} symbols`,
      status: "SUCCESS",
      metricName: "market_edge.confidence",
      metricValue: edgeConfidenceScore,
      context: { samples: samples.length, profitable: profitableConditions.length, dangerous: dangerousConditions.length },
    });
    return report;
  }

  private collectSamples(request: MarketEdgeDiscoveryRequest): MarketEdgeSample[] {
    return [
      ...(request.samples ?? []),
      ...(request.trades ? this.builder.fromTrades(request.trades) : []),
      ...(request.marketData ? this.builder.fromMarketData(request.marketData) : []),
      ...(request.liquidationHeatmaps ? this.builder.fromHeatmaps(request.liquidationHeatmaps) : []),
    ].filter((sample) => (request.symbols?.length ? request.symbols.includes(sample.symbol) : true));
  }

  private conditions(samples: MarketEdgeSample[], minSamples: number): MarketEdgeCondition[] {
    const groups = new Map<EdgeConditionType, MarketEdgeSample[]>();
    for (const sample of samples) {
      for (const condition of this.classifier.classify(sample)) {
        groups.set(condition, [...(groups.get(condition) ?? []), sample]);
      }
    }
    return Array.from(groups.entries())
      .filter(([, rows]) => rows.length >= Math.min(minSamples, Math.max(3, samples.length * 0.02)))
      .map(([type, rows]) => this.condition(type, rows));
  }

  private condition(type: EdgeConditionType, rows: MarketEdgeSample[]): MarketEdgeCondition {
    const returns = rows.map((row) => row.returnPercent ?? 0);
    const wins = returns.filter((value) => value > 0).length;
    const winrate = rows.length > 0 ? wins / rows.length * 100 : 0;
    const avgReturn = average(returns);
    const confidence = clamp(rows.length / 200 * 100, 15, 100);
    const edgeScore = clamp(50 + avgReturn * 18 + (winrate - 50) * 0.55 + confidence * 0.15, 0, 100);
    return {
      type,
      label: this.label(type),
      sampleSize: rows.length,
      winrate: Number(winrate.toFixed(2)),
      averageReturnPercent: Number(avgReturn.toFixed(4)),
      edgeScore: Number(edgeScore.toFixed(2)),
      confidence: Number(confidence.toFixed(2)),
      riskLevel: edgeScore >= 70 ? "LOW" : edgeScore >= 52 ? "MEDIUM" : edgeScore >= 35 ? "HIGH" : "EXTREME",
      reasons: [`samples=${rows.length}`, `winrate=${winrate.toFixed(2)}%`, `avgReturn=${avgReturn.toFixed(4)}%`],
    };
  }

  private strategyCompatibility(strategy: string, profitable: MarketEdgeCondition[], dangerous: MarketEdgeCondition[]): StrategyCompatibility {
    const preference = strategyPreferences[strategy] ?? { compatible: [], avoid: [] };
    const compatible = profitable.filter((condition) => preference.compatible.includes(condition.type));
    const avoided = dangerous.filter((condition) => preference.avoid.includes(condition.type));
    const score = clamp(average(compatible.map((condition) => condition.edgeScore)) - avoided.length * 8 + compatible.length * 5, 0, 100);
    const confidence = clamp(average(compatible.map((condition) => condition.confidence)) + compatible.length * 4, 0, 100);
    return {
      strategy,
      compatibleConditions: compatible.map((condition) => condition.type),
      avoidedConditions: avoided.map((condition) => condition.type),
      score: Number(score.toFixed(2)),
      confidence: Number(confidence.toFixed(2)),
      reason: `${strategy} works best with ${compatible.map((condition) => condition.label).join(", ") || "no confirmed edge yet"}`,
    };
  }

  private inefficiencies(samples: MarketEdgeSample[], conditions: MarketEdgeCondition[]): MarketInefficiency[] {
    const symbols = Array.from(new Set(samples.map((sample) => sample.symbol)));
    return symbols.flatMap((symbol) => {
      const rows = samples.filter((sample) => sample.symbol === symbol);
      const whaleScore = Math.min(100, average(rows.map((sample) => (sample.whaleNotionalUsd ?? 0) / 100_000)));
      const imbalanceScore = Math.min(100, average(rows.map((sample) => Math.abs(sample.orderbookImbalancePercent ?? 0))));
      const fakeBreakout = conditions.find((condition) => condition.type === "FAKE_BREAKOUT");
      const inefficiencies: Array<MarketInefficiency | null> = [
        whaleScore >= 25
          ? { symbol, type: "WHALE_ACTIVITY" as const, score: Number(whaleScore.toFixed(2)), confidence: 65, description: "Large notional cluster suggests whale-driven inefficiency" }
          : null,
        imbalanceScore >= 20
          ? { symbol, type: "ORDERBOOK_IMBALANCE" as const, score: Number(imbalanceScore.toFixed(2)), confidence: 60, description: "Persistent orderbook imbalance detected" }
          : null,
        fakeBreakout && fakeBreakout.sampleSize >= 5
          ? { symbol, type: "FAKE_BREAKOUT" as const, score: Number((100 - fakeBreakout.edgeScore).toFixed(2)), confidence: fakeBreakout.confidence, description: "Fake breakout frequency creates avoidable inefficiency" }
          : null,
      ];
      return inefficiencies.filter((item): item is MarketInefficiency => Boolean(item));
    });
  }

  private edgeConfidence(profitable: MarketEdgeCondition[], dangerous: MarketEdgeCondition[], sampleSize: number) {
    const profitableScore = average(profitable.map((condition) => condition.edgeScore));
    const dangerPenalty = Math.min(30, dangerous.length * 3);
    const sampleBoost = clamp(sampleSize / 10_000 * 20, 0, 20);
    return Number(clamp(profitableScore + sampleBoost - dangerPenalty, 0, 100).toFixed(2));
  }

  private label(type: EdgeConditionType) {
    return type.toLowerCase().replace(/_/gu, " ");
  }
}

const globalEdge = globalThis as typeof globalThis & { __marketEdgeDiscoveryEngine?: MarketEdgeDiscoveryEngine };
export const marketEdgeDiscoveryEngine = globalEdge.__marketEdgeDiscoveryEngine ?? new MarketEdgeDiscoveryEngine();
globalEdge.__marketEdgeDiscoveryEngine = marketEdgeDiscoveryEngine;
