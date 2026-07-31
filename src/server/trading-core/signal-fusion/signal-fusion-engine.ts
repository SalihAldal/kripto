import { clamp } from "@/src/server/trading-core/indicators/math";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import { defaultFusionWeights } from "@/src/server/trading-core/signal-fusion/fusion-weights";
import type { FusionSourceScore, SignalFusionInput, SignalFusionOutput } from "@/src/server/trading-core/signal-fusion/signal-fusion-types";
import type { TradeSide } from "@/src/server/trading-core/core/types";

function sideFromTrend(trend?: string): TradeSide {
  if (trend === "BULLISH" || trend === "TRENDING_BULLISH") return "BUY";
  if (trend === "BEARISH" || trend === "TRENDING_BEARISH") return "SELL";
  return "HOLD";
}

function scoreFunding(rate: number): { side: TradeSide; score: number } {
  if (Math.abs(rate) < 0.01) return { side: "HOLD", score: 20 };
  return rate > 0 ? { side: "SELL", score: Math.min(100, Math.abs(rate) / 0.12 * 100) } : { side: "BUY", score: Math.min(100, Math.abs(rate) / 0.12 * 100) };
}

export class SignalFusionEngine {
  fuse(input: SignalFusionInput): SignalFusionOutput {
    const weights = { ...defaultFusionWeights, ...(input.weights ?? {}) };
    const sources = this.collectSources(input).map((source) => ({
      ...source,
      weight: weights[source.source],
      weightedScore: Number((source.score * source.confidence / 100 * weights[source.source]).toFixed(4)),
    }));
    const filteredSources = this.reduceNoise(sources, input.noiseThreshold ?? 18);
    const totals = filteredSources.reduce(
      (acc, source) => {
        acc[source.side] += source.weightedScore;
        return acc;
      },
      { BUY: 0, SELL: 0, HOLD: 0 } satisfies Record<TradeSide, number>,
    );
    const side = (Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "HOLD") as TradeSide;
    const conflictScore = this.conflictScore(filteredSources);
    const noiseScore = sources.length > 0 ? (sources.length - filteredSources.length) / sources.length * 100 : 0;
    const rawScore = totals[side] * 100 / Math.max(0.01, filteredSources.reduce((sum, source) => sum + source.weight, 0));
    const confidence = this.confidence(filteredSources, side, conflictScore, noiseScore);
    const finalSide = conflictScore >= (input.conflictThreshold ?? 48) || confidence < (input.minConfidence ?? 55) ? "HOLD" : side;
    const output: SignalFusionOutput = {
      symbol: input.symbol.toUpperCase(),
      side: finalSide,
      score: Number(clamp(rawScore, 0, 100).toFixed(2)),
      confidence,
      conflictScore: Number(conflictScore.toFixed(2)),
      noiseScore: Number(noiseScore.toFixed(2)),
      sourceScores: sources,
      filteredSources,
      reasons: [
        `fusionSide=${finalSide}`,
        `rawSide=${side}`,
        `sources=${sources.length}`,
        `filtered=${filteredSources.length}`,
        `conflict=${conflictScore.toFixed(2)}`,
        `noise=${noiseScore.toFixed(2)}`,
      ],
      generatedAt: new Date().toISOString(),
      output: "json",
    };
    tradingLogger.info({
      category: "SIGNAL",
      source: "trading-core.signal-fusion",
      message: `Signal fusion ${output.symbol}: ${output.side}`,
      status: output.side === "HOLD" ? "SKIPPED" : "SUCCESS",
      symbol: output.symbol,
      metricName: "signal_fusion.confidence",
      metricValue: output.confidence,
      context: { score: output.score, conflictScore: output.conflictScore, noiseScore: output.noiseScore },
    });
    return output;
  }

  private collectSources(input: SignalFusionInput): FusionSourceScore[] {
    const rows: FusionSourceScore[] = [];
    if (input.technical) {
      rows.push(this.source("TECHNICAL_INDICATORS", input.technical.side, input.technical.score, input.technical.confidence, input.technical.reasons.slice(0, 4)));
    }
    if (input.ai) {
      rows.push(this.source("AI_PREDICTIONS", input.ai.passed ? sideFromTrend(input.ai.trend_direction) : "HOLD", input.ai.trade_confidence_score, input.ai.trade_confidence_score, input.ai.reasons));
    }
    if (input.volume) {
      rows.push(this.source("VOLUME_ANALYSIS", input.volume.side, Math.min(100, input.volume.volumeRatio * 35), input.volume.confidence, [`volumeRatio=${input.volume.volumeRatio}`]));
    }
    if (input.orderbook) {
      const spreadPenalty = Math.min(35, input.orderbook.bidAskSpreadPercent * 15);
      rows.push(this.source("ORDERBOOK_ANALYSIS", input.orderbook.side, Math.max(0, Math.abs(input.orderbook.imbalancePercent) - spreadPenalty), input.orderbook.confidence, [`imbalance=${input.orderbook.imbalancePercent}`, `spread=${input.orderbook.bidAskSpreadPercent}`]));
    }
    if (input.funding) {
      const funding = scoreFunding(input.funding.fundingRatePercent);
      rows.push(this.source("FUNDING_RATE", funding.side, funding.score, input.funding.confidence ?? Math.min(100, funding.score + 20), [`funding=${input.funding.fundingRatePercent}%`]));
    }
    if (input.liquidationHeatmap) {
      const direction = input.liquidationHeatmap.squeezeDirection === "UP" ? "BUY" : input.liquidationHeatmap.squeezeDirection === "DOWN" ? "SELL" : "HOLD";
      const confidence = Math.max(input.liquidationHeatmap.squeezeScore, input.liquidationHeatmap.manipulationRiskScore);
      rows.push(this.source("LIQUIDATION_HEATMAP", direction, input.liquidationHeatmap.squeezeScore, confidence, input.liquidationHeatmap.warnings));
    }
    if (input.marketRegime) {
      const trend = input.marketRegime.trendDirection;
      const tradeAllowed = input.marketRegime.tradeAllowed;
      rows.push(this.source("MARKET_REGIME", tradeAllowed ? sideFromTrend(trend) : "HOLD", input.marketRegime.confidence, input.marketRegime.confidence, input.marketRegime.reasons));
    }
    if (input.providerConsensus) {
      rows.push(this.source("PROVIDER_CONSENSUS", input.providerConsensus.side, input.providerConsensus.score, input.providerConsensus.confidence, input.providerConsensus.reasons));
    }
    return rows;
  }

  private source(source: FusionSourceScore["source"], side: TradeSide, score: number, confidence: number, reasons: string[]): FusionSourceScore {
    return {
      source,
      side,
      score: Number(clamp(score, 0, 100).toFixed(2)),
      confidence: Number(clamp(confidence, 0, 100).toFixed(2)),
      weight: 0,
      weightedScore: 0,
      reasons,
    };
  }

  private reduceNoise(sources: FusionSourceScore[], threshold: number) {
    return sources.filter((source) => source.confidence >= threshold && source.score >= threshold && source.side !== "HOLD");
  }

  private conflictScore(sources: FusionSourceScore[]) {
    const buy = sources.filter((source) => source.side === "BUY").reduce((sum, source) => sum + source.weightedScore, 0);
    const sell = sources.filter((source) => source.side === "SELL").reduce((sum, source) => sum + source.weightedScore, 0);
    const total = buy + sell;
    if (total <= 0) return 0;
    return Math.min(buy, sell) / total * 100;
  }

  private confidence(sources: FusionSourceScore[], side: TradeSide, conflictScore: number, noiseScore: number) {
    const sameSide = sources.filter((source) => source.side === side);
    const base = sameSide.reduce((sum, source) => sum + source.confidence * source.weight, 0) / Math.max(0.01, sameSide.reduce((sum, source) => sum + source.weight, 0));
    const sourceBoost = Math.min(10, sameSide.length * 2.5);
    return Number(clamp(base + sourceBoost - conflictScore * 0.55 - noiseScore * 0.25, 0, 100).toFixed(2));
  }
}

const globalFusion = globalThis as typeof globalThis & { __signalFusionEngine?: SignalFusionEngine };
export const signalFusionEngine = globalFusion.__signalFusionEngine ?? new SignalFusionEngine();
globalFusion.__signalFusionEngine = signalFusionEngine;
