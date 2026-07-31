import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import { getPortfolioConfig } from "@/src/server/trading-core/portfolio/portfolio-config";
import { PortfolioCorrelationAnalyzer } from "@/src/server/trading-core/portfolio/portfolio-correlation-analyzer";
import { PortfolioExposureAnalyzer } from "@/src/server/trading-core/portfolio/portfolio-exposure-analyzer";
import { PortfolioHedgeManager } from "@/src/server/trading-core/portfolio/hedge-manager";
import { PortfolioStrategyAllocationEngine } from "@/src/server/trading-core/portfolio/strategy-allocation-engine";
import type { PortfolioAnalysis, PortfolioConfig, PortfolioDecision, PortfolioIntent, PortfolioPositionInput, PortfolioRiskLevel } from "@/src/server/trading-core/portfolio/portfolio-types";

export class SmartPortfolioManager {
  private readonly exposure = new PortfolioExposureAnalyzer();
  private readonly correlation = new PortfolioCorrelationAnalyzer();
  private readonly allocation = new PortfolioStrategyAllocationEngine();
  private readonly hedge = new PortfolioHedgeManager();
  private lastAnalysis: PortfolioAnalysis | null = null;

  constructor(private readonly config: PortfolioConfig = getPortfolioConfig()) {}

  analyze(input: { userId?: string; accountEquity: number; positions: PortfolioPositionInput[]; intent?: PortfolioIntent }): PortfolioAnalysis {
    const symbolExposure = this.exposure.symbolExposure(input.positions, input.accountEquity);
    const strategyExposure = this.exposure.strategyExposure(input.positions, input.accountEquity);
    const total = this.exposure.totalExposure(input.positions, input.accountEquity);
    const correlationExposure = this.correlation.analyze(input.positions, input.accountEquity);
    const riskDistribution = this.exposure.riskDistribution(symbolExposure);
    const hedgeRecommendations = this.hedge.recommend(symbolExposure, this.config.hedgeThresholdPercent);
    const recommendedStrategyAllocation = this.allocation.recommend(strategyExposure, this.config.maxStrategyExposurePercent);
    const decision = input.intent
      ? this.decide({
          intent: input.intent,
          accountEquity: input.accountEquity,
          symbolExposure,
          strategyExposure,
          correlationExposure,
          hedgeRecommendations,
          totalExposurePercent: total.totalExposurePercent,
        })
      : undefined;

    const analysis: PortfolioAnalysis = {
      userId: input.userId,
      accountEquity: input.accountEquity,
      totalExposureUsd: total.totalExposureUsd,
      totalExposurePercent: total.totalExposurePercent,
      symbolExposure,
      strategyExposure,
      correlationExposure,
      riskDistribution,
      recommendedStrategyAllocation,
      hedgeRecommendations,
      decision,
      analyzedAt: new Date().toISOString(),
    };
    this.lastAnalysis = analysis;
    if ((decision?.riskLevel === "HIGH" || decision?.riskLevel === "CRITICAL") && decision.riskScore >= 70) {
      tradingLogger.warn({
        category: "RISK",
        source: "trading-core.portfolio",
        message: `Portfolio risk warning for ${input.intent?.symbol}`,
        status: decision.allowed ? "SKIPPED" : "FAILED",
        symbol: input.intent?.symbol,
        metricName: "portfolio.risk_score",
        metricValue: decision.riskScore,
        context: { action: decision.action, reasons: decision.reasons },
      });
    }
    return analysis;
  }

  status() {
    return {
      config: this.config,
      lastAnalysis: this.lastAnalysis,
      updatedAt: new Date().toISOString(),
    };
  }

  private decide(input: {
    intent: PortfolioIntent;
    accountEquity: number;
    symbolExposure: PortfolioAnalysis["symbolExposure"];
    strategyExposure: PortfolioAnalysis["strategyExposure"];
    correlationExposure: PortfolioAnalysis["correlationExposure"];
    hedgeRecommendations: PortfolioAnalysis["hedgeRecommendations"];
    totalExposurePercent: number;
  }): PortfolioDecision {
    const intentExposurePercent = input.accountEquity > 0 ? input.intent.requestedNotional / input.accountEquity * 100 : 0;
    const symbol = input.intent.symbol.toUpperCase();
    const currentSymbol = input.symbolExposure.find((bucket) => bucket.key === symbol)?.exposurePercent ?? 0;
    const strategyKey = input.intent.strategy ?? input.intent.botAllocation?.strategy ?? "unknown";
    const currentStrategy = input.strategyExposure.find((bucket) => bucket.key === strategyKey)?.exposurePercent ?? 0;
    const topCorrelation = input.correlationExposure[0]?.exposurePercent ?? 0;
    const projectedSymbol = currentSymbol + intentExposurePercent;
    const projectedStrategy = currentStrategy + intentExposurePercent;
    const projectedTotal = input.totalExposurePercent + intentExposurePercent;
    const riskScore = Math.min(
      100,
      projectedSymbol * 1.45 + projectedStrategy * 0.9 + projectedTotal * 0.22 + topCorrelation * 0.65,
    );
    const reasons = [
      projectedSymbol > this.config.maxSingleCoinExposurePercent ? `Single coin exposure limit exceeded: ${projectedSymbol.toFixed(2)}%` : null,
      topCorrelation > this.config.maxCorrelatedExposurePercent ? `Correlated exposure limit exceeded: ${topCorrelation.toFixed(2)}%` : null,
      projectedStrategy > this.config.maxStrategyExposurePercent ? `Strategy exposure limit exceeded: ${projectedStrategy.toFixed(2)}%` : null,
      projectedTotal > this.config.maxTotalExposurePercent ? `Total exposure limit exceeded: ${projectedTotal.toFixed(2)}%` : null,
    ].filter((reason): reason is string => Boolean(reason));
    const riskLevel = this.riskLevel(riskScore);
    const action = reasons.length > 1 || riskLevel === "CRITICAL" ? "BLOCK" : reasons.length === 1 ? "REDUCE_SIZE" : input.hedgeRecommendations.length > 0 ? "HEDGE" : "ALLOW";
    const allowed = action !== "BLOCK";
    const adjustedNotional = action === "REDUCE_SIZE" ? Math.max(0, input.intent.requestedNotional * 0.5) : input.intent.requestedNotional;
    return {
      action,
      allowed,
      riskLevel,
      riskScore: Number(riskScore.toFixed(2)),
      adjustedNotional: Number(adjustedNotional.toFixed(2)),
      reasons: reasons.length > 0 ? reasons : ["Portfolio exposure is within limits"],
      hedgeRecommendations: input.hedgeRecommendations,
    };
  }

  private riskLevel(score: number): PortfolioRiskLevel {
    if (score >= 82) return "CRITICAL";
    if (score >= 62) return "HIGH";
    if (score >= 36) return "MEDIUM";
    return "LOW";
  }
}

const globalPortfolio = globalThis as typeof globalThis & { __smartPortfolioManager?: SmartPortfolioManager };
export const smartPortfolioManager = globalPortfolio.__smartPortfolioManager ?? new SmartPortfolioManager();
globalPortfolio.__smartPortfolioManager = smartPortfolioManager;
