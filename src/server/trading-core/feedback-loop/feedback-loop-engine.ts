import { tradingConfig } from "@/src/server/trading-core/config";
import { FeedbackStore } from "@/src/server/trading-core/feedback-loop/feedback-store";
import type { FeedbackCloseTradeInput, FeedbackLoopReport, FeedbackOpenTradeInput, FeedbackRejectTradeInput, FeedbackSetupStats } from "@/src/server/trading-core/feedback-loop/feedback-loop-types";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import { selfLearningEngine } from "@/src/server/trading-core/self-learning";
import { buildDynamicLearningWeight } from "@/src/server/trading-core/self-learning/dynamic-learning-weight";
import { guardPaperStrategyMutation, resolveApplyLearningForPaper } from "@/src/server/forensics/paper-strategy-freeze.service";

export class FeedbackLoopEngine {
  private readonly store = new FeedbackStore();
  private lastReport: FeedbackLoopReport | null = null;

  openTrade(input: FeedbackOpenTradeInput) {
    const trade = this.store.open(input);
    tradingLogger.info({
      category: "TRADE_EXECUTION",
      source: "trading-core.feedback-loop",
      message: `Feedback trade opened: ${trade.symbol}`,
      status: "SUCCESS",
      symbol: trade.symbol,
      context: { tradeId: trade.tradeId, botId: trade.botId, strategy: trade.strategy, market: trade.market },
    });
    return trade;
  }

  async closeTrade(input: FeedbackCloseTradeInput): Promise<FeedbackLoopReport> {
    const trade = this.store.close(input);
    const params = trade.strategySnapshot.params ?? {};
    const learningWeight = buildDynamicLearningWeight({
      marketRegime: trade.market.marketRegime,
      volatilityPercent: trade.market.volatilityPercent,
      spreadPercent: trade.market.spreadPercent,
      liquidityDepth: trade.market.liquidityUsd,
      setupQuality: Number(params.qualityScore ?? NaN),
      aiConfidence: trade.strategySnapshot.confidenceScore,
      orderbookStability: Number.isFinite(Number(trade.market.orderbookImbalancePercent))
        ? Math.max(0, 100 - Math.abs(Number(trade.market.orderbookImbalancePercent)) * 180)
        : undefined,
      metadata: params,
    });
    const learningReport = await selfLearningEngine.learn(
      {
        tradeId: trade.tradeId,
        botId: trade.botId,
        strategy: trade.strategy,
        symbol: trade.symbol,
        side: trade.side,
        realizedPnl: trade.realizedPnl ?? 0,
        returnPercent: trade.returnPercent ?? 0,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        maxDurationSec: Number(params.maxDurationSec ?? 0),
        targetProfitPercent: Number(params.targetProfitPct ?? params.targetProfitPercent ?? 0),
        stopLossPercent: Number(params.stopLossPct ?? params.stopLossPercent ?? 0),
        qualityScore: Number(params.qualityScore ?? NaN),
        marketRegime: trade.market.marketRegime,
        learningWeight: learningWeight.weight,
        learningWeightProfile: learningWeight,
        indicators: trade.strategySnapshot.indicators,
        reasons: trade.strategySnapshot.edgeConditions?.flatMap((condition) => condition.reasons),
        edgeConditions: trade.strategySnapshot.edgeConditions,
        openedAt: trade.openedAt,
        closedAt: trade.closedAt,
      },
      resolveApplyLearningForPaper(Boolean(input.applyLearning)),
    );
    const setupStats = this.store.setupStats().find((item) => item.setupKey === this.setupKeyFromLearning(learningReport.pattern.patternKey, trade.botId)) ?? this.bestStatsForTrade(trade.strategy);
    if (input.applyLearning && setupStats && guardPaperStrategyMutation()) this.applyAdaptiveConfig(setupStats);
    const report: FeedbackLoopReport = {
      trade,
      learningReport,
      setupStats: setupStats ?? this.emptyStats(trade.botId, trade.strategy, trade.market.marketRegime),
      botMarketSuccess: this.botMarketSuccess(),
      blacklistedSetups: this.blacklistedSetups(),
      boostedSetups: this.boostedSetups(),
      generatedAt: new Date().toISOString(),
    };
    this.lastReport = report;
    tradingLogger.info({
      category: "BOT",
      source: "trading-core.feedback-loop",
      message: `Feedback loop closed ${trade.tradeId}: ${learningReport.outcome}`,
      status: "SUCCESS",
      symbol: trade.symbol,
      metricName: "feedback_loop.adaptive_confidence",
      metricValue: report.setupStats.adaptiveConfidenceScore,
      context: { setupStatus: report.setupStats.status, dynamicWeight: report.setupStats.dynamicWeight, learningWeight },
    });
    return report;
  }

  async rejectTrade(input: FeedbackRejectTradeInput) {
    const trade = this.store.reject(input);
    const params = trade.strategySnapshot.params ?? {};
    const learningWeight = buildDynamicLearningWeight({
      marketRegime: trade.market.marketRegime,
      volatilityPercent: trade.market.volatilityPercent,
      spreadPercent: trade.market.spreadPercent,
      liquidityDepth: trade.market.liquidityUsd,
      setupQuality: Number(params.qualityScore ?? NaN),
      aiConfidence: trade.strategySnapshot.confidenceScore,
      metadata: { ...params, rejectReason: input.rejectReason, signalCleanliness: 20 },
      signalCleanliness: 20,
    });
    const learningReport = await selfLearningEngine.learn(
      {
        tradeId: trade.tradeId,
        botId: trade.botId,
        strategy: trade.strategy,
        symbol: trade.symbol,
        side: trade.side,
        realizedPnl: trade.realizedPnl ?? -0.000001,
        returnPercent: trade.returnPercent ?? -0.05,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        maxDurationSec: Number(params.maxDurationSec ?? 0),
        targetProfitPercent: Number(params.targetProfitPct ?? params.targetProfitPercent ?? 0),
        stopLossPercent: Number(params.stopLossPct ?? params.stopLossPercent ?? 0),
        qualityScore: Number(params.qualityScore ?? NaN),
        marketRegime: trade.market.marketRegime,
        learningWeight: learningWeight.weight,
        learningWeightProfile: learningWeight,
        indicators: trade.strategySnapshot.indicators,
        reasons: [input.rejectReason, ...(trade.strategySnapshot.edgeConditions?.flatMap((condition) => condition.reasons) ?? [])],
        edgeConditions: trade.strategySnapshot.edgeConditions,
        openedAt: trade.openedAt,
        closedAt: trade.closedAt,
      },
      false,
    );
    const setupStats = this.bestStatsForTrade(trade.strategy) ?? this.emptyStats(trade.botId, trade.strategy, trade.market.marketRegime);
    const report: FeedbackLoopReport = {
      trade,
      learningReport,
      setupStats,
      botMarketSuccess: this.botMarketSuccess(),
      blacklistedSetups: this.blacklistedSetups(),
      boostedSetups: this.boostedSetups(),
      generatedAt: new Date().toISOString(),
    };
    this.lastReport = report;
    tradingLogger.info({
      category: "BOT",
      source: "trading-core.feedback-loop",
      message: `Feedback trade rejected: ${trade.symbol}`,
      status: "SUCCESS",
      symbol: trade.symbol,
      context: { tradeId: trade.tradeId, botId: trade.botId, strategy: trade.strategy, rejectReason: input.rejectReason },
    });
    return report;
  }

  snapshot() {
    const snapshot = this.store.snapshot();
    return {
      ...snapshot,
      blacklistedSetups: this.blacklistedSetups(),
      boostedSetups: this.boostedSetups(),
      lastReport: this.lastReport,
      updatedAt: new Date().toISOString(),
    };
  }

  private applyAdaptiveConfig(stats: FeedbackSetupStats) {
    const currentStrategy = tradingConfig.getStrategy(stats.strategy);
    const currentBot = tradingConfig.getBot(stats.botId);
    if (stats.status === "BLACKLISTED") {
      tradingConfig.updateStrategy(stats.strategy, { minScore: Math.min(90, currentStrategy.minScore + 3) });
      tradingConfig.updateBot(stats.botId, { ...(currentBot ?? { enabled: true, minScore: 60, maxOpenPositions: 1, cooldownMsAfterLoss: 300_000 }), minScore: Math.min(90, (currentBot?.minScore ?? 60) + 3) });
    }
    if (stats.status === "BOOSTED") {
      tradingConfig.updateStrategy(stats.strategy, { minScore: Math.max(45, currentStrategy.minScore - 1) });
      tradingConfig.updateBot(stats.botId, { ...(currentBot ?? { enabled: true, minScore: 60, maxOpenPositions: 1, cooldownMsAfterLoss: 300_000 }), minScore: Math.max(45, (currentBot?.minScore ?? 60) - 1) });
    }
  }

  private botMarketSuccess() {
    return this.store.setupStats().filter((stats) => stats.trades >= 2).sort((a, b) => b.adaptiveConfidenceScore - a.adaptiveConfidenceScore);
  }

  private blacklistedSetups() {
    return this.store.setupStats().filter((stats) => stats.status === "BLACKLISTED");
  }

  private boostedSetups() {
    return this.store.setupStats().filter((stats) => stats.status === "BOOSTED");
  }

  private bestStatsForTrade(strategy: string) {
    return this.store.setupStats().find((item) => item.strategy === strategy);
  }

  private setupKeyFromLearning(patternKey: string, botId: string) {
    return `${botId}:${patternKey}`;
  }

  private emptyStats(botId: string, strategy: string, marketRegime?: string): FeedbackSetupStats {
    return {
      setupKey: `${botId}:${strategy}:${marketRegime ?? "UNKNOWN"}`,
      botId,
      strategy,
      marketRegime,
      trades: 0,
      wins: 0,
      losses: 0,
      winrate: 0,
      averageReturnPercent: 0,
      adaptiveConfidenceScore: 50,
      dynamicWeight: 1,
      status: "NEUTRAL",
      reasons: ["No setup statistics yet"],
      updatedAt: new Date().toISOString(),
    };
  }
}

const globalFeedback = globalThis as typeof globalThis & { __feedbackLoopEngine?: FeedbackLoopEngine };
export const feedbackLoopEngine = globalFeedback.__feedbackLoopEngine ?? new FeedbackLoopEngine();
globalFeedback.__feedbackLoopEngine = feedbackLoopEngine;
