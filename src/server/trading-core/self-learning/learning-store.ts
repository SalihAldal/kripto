import { Prisma } from "@prisma/client";
import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import type { LearningNumericFeature } from "@/src/server/metrics/setup-feature-utils";
import { buildSetupFeatureSnapshot } from "@/src/server/metrics/setup-feature-utils";
import { buildDynamicLearningWeight, type DynamicLearningWeight } from "@/src/server/trading-core/self-learning/dynamic-learning-weight";
import { runDeepPostTradeAnalysis } from "@/src/server/trading-core/self-learning/deep-post-trade-analysis";
import type { LearningMarketEvidenceSnapshot } from "@/src/server/trading-core/self-learning/market-evidence-archive";
import { collectLearningMarketEvidence } from "@/src/server/trading-core/self-learning/market-evidence-archive";
import type { DeepPostTradeAnalysis, PostTradeCritic, TpslOptimizationSuggestion, TradeLearningHorizon } from "@/src/server/trading-core/self-learning/self-learning-types";

type PersistLearningTradeInput = {
  userId: string;
  tradingPairId: string;
  positionId?: string | null;
  tradeId: string;
  symbol: string;
  mode: string;
  side: "BUY" | "SELL";
  strategy: string;
  horizon: TradeLearningHorizon;
  outcome: "WIN" | "LOSS" | "BREAKEVEN";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  realizedPnl: number;
  returnPercent: number;
  targetProfitPercent?: number;
  stopLossPercent?: number;
  maxDurationSec?: number;
  holdSec?: number;
  closeReason?: string;
  marketRegime?: string;
  qualityScore?: number;
  patternKey: string;
  features: string[];
  numericFeatures: LearningNumericFeature[];
  critic?: PostTradeCritic;
  tpslSuggestion?: TpslOptimizationSuggestion;
  deepAnalysis?: DeepPostTradeAnalysis;
  learningWeight?: number;
  learningWeightProfile?: DynamicLearningWeight;
  marketEvidence?: LearningMarketEvidenceSnapshot;
  metadata?: Record<string, unknown>;
  openedAt?: Date;
  closedAt?: Date;
};

type PatternStats = {
  patternKey: string;
  sampleCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  winrate: number;
  averageReturnPercent: number;
  totalReturnPercent: number;
  bestReturnPercent: number;
  worstReturnPercent: number;
  maxDrawdownPercent: number;
  expectancyPercent: number;
  confidenceScore: number;
  status: "DRAFT" | "PAPER_VALIDATED" | "LIVE_ADVISORY" | "LIVE_ACTIVE" | "DISABLED";
};

type WeightedPatternStats = {
  weightedSampleCount: number;
  weightedWins: number;
  weightedLosses: number;
  weightedBreakevens: number;
  weightedWinrate: number;
  weightedAverageReturnPercent: number;
  weightedTotalReturnPercent: number;
  averageLearningWeight: number;
  lastLearningWeight: number;
};

type RegimeExpectancyStats = {
  strategy: string;
  marketRegime?: string;
  sampleCount: number;
  winrate: number;
  averageReturnPercent: number;
  expectancyPercent: number;
};

const db = prisma as unknown as {
  learningTrade: {
    upsert: (args: unknown) => Promise<{ id: string }>;
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    count: (args?: unknown) => Promise<number>;
  };
  position: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  };
  learningFeature: {
    deleteMany: (args: unknown) => Promise<unknown>;
    createMany: (args: unknown) => Promise<unknown>;
  };
  learningMarketEvidence: {
    deleteMany: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<Record<string, unknown>>;
  };
  learningPatternStats: {
    upsert: (args: unknown) => Promise<PatternStats>;
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    count: (args?: unknown) => Promise<number>;
  };
  learningPolicyPatch: {
    findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
    create: (args: unknown) => Promise<Record<string, unknown>>;
    update: (args: unknown) => Promise<Record<string, unknown>>;
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    count: (args?: unknown) => Promise<number>;
  };
};

function finite(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function optionalFinite(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function extractDeepAnalysis(row: Record<string, unknown>): DeepPostTradeAnalysis | undefined {
  const metadata = jsonObject(row.metadata);
  const deep = jsonObject(metadata.deepAnalysis);
  return deep.rootCause ? deep as DeepPostTradeAnalysis : undefined;
}

function extractMarketEvidence(row: Record<string, unknown>): LearningMarketEvidenceSnapshot["summary"] | undefined {
  const metadata = jsonObject(row.metadata);
  const evidence = jsonObject(metadata.marketEvidence);
  const summary = jsonObject(evidence.summary);
  return Object.keys(summary).length > 0 ? summary as LearningMarketEvidenceSnapshot["summary"] : undefined;
}

function extractLearningWeight(row: Record<string, unknown>) {
  const metadata = jsonObject(row.metadata);
  const profile = jsonObject(metadata.learningWeightProfile);
  return Math.max(0.12, Math.min(2.25, finite(profile.weight ?? metadata.learningWeight, 1)));
}

function summarizeMarketEvidence(trades: Array<Record<string, unknown>>) {
  const recent = trades.flatMap((row) => {
    const summary = extractMarketEvidence(row);
    if (!summary) return [];
    return [{
      tradeId: row.tradeId,
      symbol: row.symbol,
      patternKey: row.patternKey,
      fundingRate: summary.fundingRate,
      openInterest: summary.openInterest,
      liquidationImbalance: summary.liquidationImbalance,
      orderBookImbalance: summary.orderBookImbalance,
      buySellRatio: summary.buySellRatio,
      volumeSpikeRatio: summary.volumeSpikeRatio,
      newsSentiment: summary.newsSentiment,
      macroHighImpactNews: summary.macroHighImpactNews,
      macroUncertaintyLevel: summary.macroUncertaintyLevel,
    }];
  });
  return { recent };
}

function calibrationSummary(trades: Array<Record<string, unknown>>) {
  const rows = trades.flatMap((row) => {
    const deep = extractDeepAnalysis(row);
    if (!deep) return [];
    return [{
      recommendation: deep.policyRecommendation,
      source: deep.source,
      confidence: finite(deep.confidence),
      outcome: String(row.outcome ?? ""),
      returnPercent: finite(row.returnPercent),
      tags: deep.learningTags ?? [],
    }];
  });
  const byRecommendation = new Map<string, { count: number; wins: number; losses: number; totalReturn: number; avgConfidence: number }>();
  const tagStats = new Map<string, { count: number; wins: number; losses: number; totalReturn: number }>();
  for (const row of rows) {
    const rec = byRecommendation.get(row.recommendation) ?? { count: 0, wins: 0, losses: 0, totalReturn: 0, avgConfidence: 0 };
    rec.count += 1;
    rec.wins += row.outcome === "WIN" ? 1 : 0;
    rec.losses += row.outcome === "LOSS" ? 1 : 0;
    rec.totalReturn += row.returnPercent;
    rec.avgConfidence += row.confidence;
    byRecommendation.set(row.recommendation, rec);
    for (const tag of row.tags) {
      const stat = tagStats.get(tag) ?? { count: 0, wins: 0, losses: 0, totalReturn: 0 };
      stat.count += 1;
      stat.wins += row.outcome === "WIN" ? 1 : 0;
      stat.losses += row.outcome === "LOSS" ? 1 : 0;
      stat.totalReturn += row.returnPercent;
      tagStats.set(tag, stat);
    }
  }
  const normalize = (entry: [string, { count: number; wins: number; losses: number; totalReturn: number; avgConfidence?: number }]) => {
    const [key, value] = entry;
    return {
      key,
      count: value.count,
      winrate: round((value.wins / Math.max(1, value.count)) * 100, 2),
      averageReturnPercent: round(value.totalReturn / Math.max(1, value.count), 4),
      avgConfidence: value.avgConfidence === undefined ? undefined : round(value.avgConfidence / Math.max(1, value.count), 2),
    };
  };
  return {
    sampleCount: rows.length,
    byRecommendation: Array.from(byRecommendation.entries()).map(normalize),
    tagCalibration: Array.from(tagStats.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 30)
      .map(normalize),
    updatedAt: new Date().toISOString(),
  };
}

function summarizeDeepAnalyses(trades: Array<Record<string, unknown>>) {
  const rootCauseCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const recommendationCounts = new Map<string, number>();
  const recent = trades.flatMap((row) => {
    const deep = extractDeepAnalysis(row);
    if (!deep) return [];
    rootCauseCounts.set(deep.rootCause, (rootCauseCounts.get(deep.rootCause) ?? 0) + 1);
    recommendationCounts.set(deep.policyRecommendation, (recommendationCounts.get(deep.policyRecommendation) ?? 0) + 1);
    for (const tag of deep.learningTags ?? []) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
    return [{
      tradeId: row.tradeId,
      symbol: row.symbol,
      patternKey: row.patternKey,
      outcome: row.outcome,
      returnPercent: row.returnPercent,
      rootCause: deep.rootCause,
      policyRecommendation: deep.policyRecommendation,
      confidence: deep.confidence,
      source: deep.source,
      learningTags: deep.learningTags,
      generatedAt: deep.generatedAt,
    }];
  });
  const top = (map: Map<string, number>) =>
    Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([value, count]) => ({ value, count }));
  return {
    recent,
    rootCauseStats: top(rootCauseCounts),
    deepTagStats: top(tagCounts),
    policyRecommendationStats: top(recommendationCounts),
  };
}

function resolvePolicyStatus(stats: Omit<PatternStats, "status">): PatternStats["status"] {
  if (stats.sampleCount < 20) return "DRAFT";
  if (stats.expectancyPercent <= 0 || stats.maxDrawdownPercent >= 8 || stats.winrate < 48) return "PAPER_VALIDATED";
  if (stats.sampleCount < 100) return "PAPER_VALIDATED";
  if (stats.sampleCount >= 200 && stats.winrate >= 58 && stats.expectancyPercent >= 0.15 && stats.maxDrawdownPercent <= 4) {
    return "LIVE_ACTIVE";
  }
  return "LIVE_ADVISORY";
}

function computeStats(patternKey: string, trades: Array<Record<string, unknown>>): PatternStats {
  const returns = trades.map((row) => finite(row.returnPercent));
  const sampleCount = returns.length;
  const wins = trades.filter((row) => row.outcome === "WIN").length;
  const losses = trades.filter((row) => row.outcome === "LOSS").length;
  const breakevens = trades.filter((row) => row.outcome === "BREAKEVEN").length;
  const totalReturnPercent = returns.reduce((acc, value) => acc + value, 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdownPercent = 0;
  for (const value of returns) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdownPercent = Math.max(maxDrawdownPercent, peak - equity);
  }
  const averageReturnPercent = sampleCount > 0 ? totalReturnPercent / sampleCount : 0;
  const expectancyPercent = averageReturnPercent - maxDrawdownPercent * 0.03;
  const confidenceScore = Math.max(
    0,
    Math.min(100, sampleCount * 0.45 + (wins / Math.max(1, sampleCount)) * 35 + Math.max(-20, expectancyPercent * 12) - maxDrawdownPercent * 1.2),
  );
  const base = {
    patternKey,
    sampleCount,
    wins,
    losses,
    breakevens,
    winrate: round((wins / Math.max(1, sampleCount)) * 100, 2),
    averageReturnPercent: round(averageReturnPercent),
    totalReturnPercent: round(totalReturnPercent),
    bestReturnPercent: round(returns.length ? Math.max(...returns) : 0),
    worstReturnPercent: round(returns.length ? Math.min(...returns) : 0),
    maxDrawdownPercent: round(maxDrawdownPercent),
    expectancyPercent: round(expectancyPercent),
    confidenceScore: round(confidenceScore, 2),
  };
  return { ...base, status: resolvePolicyStatus(base) };
}

function computeWeightedStats(trades: Array<Record<string, unknown>>): WeightedPatternStats {
  let weightedSampleCount = 0;
  let weightedWins = 0;
  let weightedLosses = 0;
  let weightedBreakevens = 0;
  let weightedTotalReturnPercent = 0;
  let lastLearningWeight = 1;
  for (const row of trades) {
    const weight = extractLearningWeight(row);
    lastLearningWeight = weight;
    weightedSampleCount += weight;
    weightedTotalReturnPercent += finite(row.returnPercent) * weight;
    if (row.outcome === "WIN") weightedWins += weight;
    else if (row.outcome === "LOSS") weightedLosses += weight;
    else weightedBreakevens += weight;
  }
  return {
    weightedSampleCount: round(weightedSampleCount),
    weightedWins: round(weightedWins),
    weightedLosses: round(weightedLosses),
    weightedBreakevens: round(weightedBreakevens),
    weightedWinrate: round((weightedWins / Math.max(0.0001, weightedSampleCount)) * 100, 2),
    weightedAverageReturnPercent: round(weightedTotalReturnPercent / Math.max(0.0001, weightedSampleCount)),
    weightedTotalReturnPercent: round(weightedTotalReturnPercent),
    averageLearningWeight: round(weightedSampleCount / Math.max(1, trades.length)),
    lastLearningWeight: round(lastLearningWeight),
  };
}

function computeExpectancyStats(strategy: string, marketRegime: string | undefined, trades: Array<Record<string, unknown>>): RegimeExpectancyStats {
  const returns = trades.map((row) => finite(row.returnPercent));
  const wins = trades.filter((row) => row.outcome === "WIN").length;
  const totalReturn = returns.reduce((acc, value) => acc + value, 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of returns) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  const sampleCount = returns.length;
  const averageReturnPercent = sampleCount > 0 ? totalReturn / sampleCount : 0;
  return {
    strategy,
    marketRegime,
    sampleCount,
    winrate: round((wins / Math.max(1, sampleCount)) * 100, 2),
    averageReturnPercent: round(averageReturnPercent),
    expectancyPercent: round(averageReturnPercent - maxDrawdown * 0.03),
  };
}

function computeExpectancyByRegime(strategy: string, trades: Array<Record<string, unknown>>) {
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const trade of trades) {
    const regime = String(trade.marketRegime ?? "UNKNOWN");
    grouped.set(regime, [...(grouped.get(regime) ?? []), trade]);
  }
  return Array.from(grouped.entries())
    .map(([regime, rows]) => computeExpectancyStats(strategy, regime, rows))
    .sort((a, b) => b.expectancyPercent - a.expectancyPercent);
}

export async function getHistoricalStrategyRegimeExpectancy(input: {
  strategy: string;
  marketRegime?: string;
  take?: number;
}) {
  const rows = await db.learningTrade.findMany({
    where: {
      strategy: input.strategy,
      ...(input.marketRegime ? { marketRegime: input.marketRegime } : {}),
    },
    orderBy: { closedAt: "desc" },
    take: Math.max(20, Math.min(500, input.take ?? 250)),
  }).catch(() => []);
  return computeExpectancyStats(input.strategy, input.marketRegime, rows);
}

function policyAction(stats: PatternStats, deepAnalysis?: DeepPostTradeAnalysis) {
  if (
    deepAnalysis?.policyRecommendation === "BLOCK" &&
    stats.sampleCount >= 20 &&
    stats.confidenceScore >= 45
  ) {
    return "TIGHTEN_OR_BLOCK";
  }
  if (deepAnalysis?.policyRecommendation === "TIGHTEN" && stats.sampleCount >= 12) {
    return "TIGHTEN_OR_BLOCK";
  }
  if (stats.status === "LIVE_ACTIVE") return "APPLY_FILTER_ADJUSTMENT";
  if (stats.status === "LIVE_ADVISORY") return "ADVISE_FILTER_ADJUSTMENT";
  if (stats.losses > stats.wins && stats.sampleCount >= 20) return "TIGHTEN_OR_BLOCK";
  return "OBSERVE";
}

function policyReason(stats: PatternStats, deepAnalysis?: DeepPostTradeAnalysis) {
  const deepReason = deepAnalysis
    ? `, deep=${deepAnalysis.policyRecommendation}, root=${deepAnalysis.rootCause.slice(0, 120)}`
    : "";
  return `samples=${stats.sampleCount}, winrate=${stats.winrate}%, expectancy=${stats.expectancyPercent}%, drawdown=${stats.maxDrawdownPercent}%${deepReason}`;
}

function criticVerdictFromDeep(input: PersistLearningTradeInput) {
  if (input.deepAnalysis?.policyRecommendation === "BLOCK") return "PAUSE_SETUP";
  if (input.deepAnalysis?.policyRecommendation === "TIGHTEN") return "TIGHTEN_FILTERS";
  if (input.deepAnalysis?.policyRecommendation === "BOOST") return "SCALE_UP";
  return input.critic?.verdict;
}

function criticSummaryFromDeep(input: PersistLearningTradeInput) {
  return input.deepAnalysis?.professionalSummary ?? input.critic?.summary;
}

async function upsertPolicyPatch(input: PersistLearningTradeInput, stats: PatternStats) {
  const action = policyAction(stats, input.deepAnalysis);
  const deepRecommendation = input.deepAnalysis?.policyRecommendation;
  const boostAllowed =
    deepRecommendation === "BOOST" &&
    stats.maxDrawdownPercent <= 4 &&
    stats.expectancyPercent > 0 &&
    stats.winrate >= 52;
  const existing = await db.learningPolicyPatch.findFirst({
    where: {
      patternKey: input.patternKey,
      status: { not: "DISABLED" },
    },
    orderBy: { updatedAt: "desc" },
  });
  const data = {
    userId: input.userId,
    patternKey: input.patternKey,
    status: stats.status,
    action,
    reason: policyReason(stats, input.deepAnalysis),
    sampleCount: stats.sampleCount,
    confidenceScore: stats.confidenceScore,
    winrate: stats.winrate,
    expectancyPercent: stats.expectancyPercent,
    maxDrawdownPercent: stats.maxDrawdownPercent,
    minScoreDelta: action === "TIGHTEN_OR_BLOCK" ? 8 : boostAllowed || stats.status === "LIVE_ACTIVE" ? -1 : 0,
    sizeMultiplier: action === "TIGHTEN_OR_BLOCK" ? 0.45 : boostAllowed || stats.status === "LIVE_ACTIVE" ? 1.05 : 1,
    suggestedTakeProfitPercent: input.tpslSuggestion?.suggestedTakeProfitPercent,
    suggestedStopLossPercent: input.tpslSuggestion?.suggestedStopLossPercent,
    suggestedMaxDurationSec: input.tpslSuggestion?.suggestedMaxDurationSec,
    metadata: {
      symbol: input.symbol,
      horizon: input.horizon,
      mode: input.mode,
      critic: input.critic,
      tpslSuggestion: input.tpslSuggestion,
      deepAnalysis: input.deepAnalysis,
      marketEvidence: input.marketEvidence?.summary,
      learningWeight: input.learningWeightProfile,
      deepRecommendation,
      boostAllowed,
    } as Prisma.InputJsonValue,
  };
  if (existing?.id) {
    return db.learningPolicyPatch.update({ where: { id: existing.id }, data });
  }
  return db.learningPolicyPatch.create({ data });
}

async function persistMarketEvidence(learningTradeId: string, input: PersistLearningTradeInput) {
  if (!input.marketEvidence) return null;
  const evidence = input.marketEvidence;
  const summary = evidence.summary;
  await db.learningMarketEvidence.deleteMany({ where: { learningTradeId } });
  return db.learningMarketEvidence.create({
    data: {
      learningTradeId,
      symbol: evidence.symbol,
      futuresSymbol: evidence.futuresSymbol,
      capturedAt: new Date(evidence.capturedAt),
      spotLastPrice: summary.spotLastPrice,
      spotBidPrice: summary.spotBidPrice,
      spotAskPrice: summary.spotAskPrice,
      spotSpreadPercent: summary.spotSpreadPercent,
      spotVolume24h: summary.spotVolume24h,
      orderBookBidDepth: summary.orderBookBidDepth,
      orderBookAskDepth: summary.orderBookAskDepth,
      orderBookImbalance: summary.orderBookImbalance,
      recentBuyVolume: summary.recentBuyVolume,
      recentSellVolume: summary.recentSellVolume,
      buySellRatio: summary.buySellRatio,
      volumeSpikeRatio: summary.volumeSpikeRatio,
      markPrice: summary.markPrice,
      indexPrice: summary.indexPrice,
      fundingRate: summary.fundingRate,
      nextFundingTime: summary.nextFundingTime ? new Date(summary.nextFundingTime) : undefined,
      openInterest: summary.openInterest,
      liquidationBuyQty: summary.liquidationBuyQty,
      liquidationSellQty: summary.liquidationSellQty,
      liquidationBuyNotional: summary.liquidationBuyNotional,
      liquidationSellNotional: summary.liquidationSellNotional,
      liquidationImbalance: summary.liquidationImbalance,
      newsSentiment: summary.newsSentiment,
      macroHighImpactNews: summary.macroHighImpactNews,
      macroUncertaintyLevel: summary.macroUncertaintyLevel,
      rawSpot: {
        ticker: evidence.raw.ticker,
        orderBook: evidence.raw.orderBook,
        recentTrades: evidence.raw.recentTrades,
        klines: evidence.raw.klines,
      } as Prisma.InputJsonValue,
      rawFutures: evidence.raw.futures as Prisma.InputJsonValue,
      rawNews: evidence.raw.news as Prisma.InputJsonValue,
      metadata: {
        errors: evidence.raw.errors ?? [],
        summary,
      } as Prisma.InputJsonValue,
    },
  });
}

export async function persistLearningTrade(input: PersistLearningTradeInput) {
  const learningWeightProfile = input.learningWeightProfile ?? buildDynamicLearningWeight({
    marketRegime: input.marketRegime,
    regimeConfidence: optionalFinite(jsonObject(input.metadata).marketRegimeConfidenceScore),
    volatilityPercent: input.numericFeatures.find((feature) => feature.key === "volatilityPercent")?.value,
    fakeSpikeScore: input.numericFeatures.find((feature) => feature.key === "fakeSpikeScore")?.value,
    pumpRisk: input.numericFeatures.find((feature) => feature.key === "pumpRisk")?.value,
    spreadPercent: input.numericFeatures.find((feature) => feature.key === "spreadPercent")?.value,
    mtfAlignment: input.numericFeatures.find((feature) => feature.key === "mtfAlignment")?.value,
    setupQuality: input.qualityScore,
    aiConfidence: input.numericFeatures.find((feature) => feature.key === "aiConfidence")?.value,
    criticConfidence: input.deepAnalysis?.confidence,
    deepAnalysis: input.deepAnalysis,
    critic: input.critic,
    numericFeatures: input.numericFeatures,
    metadata: input.metadata,
  });
  const enrichedMetadata = {
    ...(input.metadata ?? {}),
    learningWeight: learningWeightProfile.weight,
    learningWeightProfile,
    learningWeightHistory: [
      {
        tradeId: input.tradeId,
        patternKey: input.patternKey,
        weight: learningWeightProfile.weight,
        label: learningWeightProfile.label,
        regimeCompatibility: input.deepAnalysis?.regimeCompatibility,
        generatedAt: learningWeightProfile.generatedAt,
      },
    ],
  };
  const enrichedNumericFeatures = [
    ...input.numericFeatures,
    ...(input.deepAnalysis?.regimeCompatibility
      ? [
          {
            key: "regimeCompatibilityScore",
            value: input.deepAnalysis.regimeCompatibility.compatibilityScore,
            category: "regime",
            weight: input.deepAnalysis.regimeCompatibility.penaltyMultiplier,
          },
          {
            key: "regimeCompatibilityPenalty",
            value: input.deepAnalysis.regimeCompatibility.penaltyMultiplier,
            category: "regime",
            weight: 1,
          },
        ]
      : []),
    { key: "learningWeight", value: learningWeightProfile.weight, category: "learning", weight: learningWeightProfile.weight },
    { key: "learningWeightConfidence", value: learningWeightProfile.confidence, category: "learning", weight: 0.7 },
  ];
  const learningTrade = await db.learningTrade.upsert({
    where: { tradeId: input.tradeId },
    create: {
      userId: input.userId,
      tradingPairId: input.tradingPairId,
      positionId: input.positionId ?? undefined,
      tradeId: input.tradeId,
      symbol: input.symbol,
      mode: input.mode,
      side: input.side,
      strategy: input.strategy,
      horizon: input.horizon,
      outcome: input.outcome,
      entryPrice: input.entryPrice,
      exitPrice: input.exitPrice,
      quantity: input.quantity,
      realizedPnl: input.realizedPnl,
      returnPercent: input.returnPercent,
      targetProfitPercent: input.targetProfitPercent,
      stopLossPercent: input.stopLossPercent,
      maxDurationSec: input.maxDurationSec,
      holdSec: input.holdSec,
      closeReason: input.closeReason,
      marketRegime: input.marketRegime,
      qualityScore: input.qualityScore,
      patternKey: input.patternKey,
      criticGrade: input.critic?.grade,
      criticVerdict: criticVerdictFromDeep(input),
      criticSummary: criticSummaryFromDeep(input),
      tpslSuggestion: input.tpslSuggestion as Prisma.InputJsonValue,
      metadata: enrichedMetadata as Prisma.InputJsonValue,
      openedAt: input.openedAt,
      closedAt: input.closedAt,
    },
    update: {
      outcome: input.outcome,
      exitPrice: input.exitPrice,
      realizedPnl: input.realizedPnl,
      returnPercent: input.returnPercent,
      closeReason: input.closeReason,
      criticGrade: input.critic?.grade,
      criticVerdict: criticVerdictFromDeep(input),
      criticSummary: criticSummaryFromDeep(input),
      tpslSuggestion: input.tpslSuggestion as Prisma.InputJsonValue,
      metadata: enrichedMetadata as Prisma.InputJsonValue,
      closedAt: input.closedAt,
    },
  });

  const marketEvidence = await persistMarketEvidence(learningTrade.id, input);

  await db.learningFeature.deleteMany({ where: { learningTradeId: learningTrade.id } });
  const featureRows = [
    ...input.features.map((feature) => {
      const [key, ...rest] = feature.split(":");
      return {
        learningTradeId: learningTrade.id,
        featureKey: key,
        featureValue: rest.join(":") || feature,
        category: key,
        weight: 1,
      };
    }),
    ...enrichedNumericFeatures.map((feature) => ({
      learningTradeId: learningTrade.id,
      featureKey: feature.key,
      featureValue: String(feature.value),
      numericValue: feature.value,
      category: feature.category,
      weight: feature.weight ?? 1,
    })),
  ];
  if (featureRows.length > 0) {
    await db.learningFeature.createMany({ data: featureRows });
  }

  const trades = await db.learningTrade.findMany({
    where: { patternKey: input.patternKey },
    orderBy: { closedAt: "asc" },
  });
  const stats = computeStats(input.patternKey, trades);
  const weightedStats = computeWeightedStats(trades);
  const strategyTrades = await db.learningTrade.findMany({
    where: { strategy: input.strategy },
    orderBy: { closedAt: "desc" },
    take: 500,
  }).catch(() => []);
  const regimeStrategyExpectancy = computeExpectancyStats(
    input.strategy,
    input.marketRegime,
    strategyTrades.filter((trade) => String(trade.marketRegime ?? "UNKNOWN") === String(input.marketRegime ?? "UNKNOWN")),
  );
  const strategyExpectancyByRegime = computeExpectancyByRegime(input.strategy, strategyTrades);
  const persistedStats = await db.learningPatternStats.upsert({
    where: { patternKey: input.patternKey },
    create: {
      ...stats,
      strategy: input.strategy,
      horizon: input.horizon,
      marketRegime: input.marketRegime,
      suggestedTakeProfitPercent: input.tpslSuggestion?.suggestedTakeProfitPercent,
      suggestedStopLossPercent: input.tpslSuggestion?.suggestedStopLossPercent,
      suggestedMaxDurationSec: input.tpslSuggestion?.suggestedMaxDurationSec,
      lastCriticVerdict: input.deepAnalysis?.policyRecommendation ?? input.critic?.verdict,
      featureSummary: {
        features: input.features,
        numericFeatures: enrichedNumericFeatures,
        learningWeight: learningWeightProfile,
        weightedStats,
        regimeCompatibility: input.deepAnalysis?.regimeCompatibility,
        regimeStrategyExpectancy,
        strategyExpectancyByRegime,
        deepAnalysis: input.deepAnalysis,
        marketEvidence: input.marketEvidence?.summary,
        deepTags: input.deepAnalysis?.learningTags ?? [],
        rootCause: input.deepAnalysis?.rootCause,
      } as Prisma.InputJsonValue,
      lastSeenAt: input.closedAt ?? new Date(),
    },
    update: {
      ...stats,
      strategy: input.strategy,
      horizon: input.horizon,
      marketRegime: input.marketRegime,
      suggestedTakeProfitPercent: input.tpslSuggestion?.suggestedTakeProfitPercent,
      suggestedStopLossPercent: input.tpslSuggestion?.suggestedStopLossPercent,
      suggestedMaxDurationSec: input.tpslSuggestion?.suggestedMaxDurationSec,
      lastCriticVerdict: input.deepAnalysis?.policyRecommendation ?? input.critic?.verdict,
      featureSummary: {
        features: input.features,
        numericFeatures: enrichedNumericFeatures,
        learningWeight: learningWeightProfile,
        weightedStats,
        regimeCompatibility: input.deepAnalysis?.regimeCompatibility,
        regimeStrategyExpectancy,
        strategyExpectancyByRegime,
        deepAnalysis: input.deepAnalysis,
        marketEvidence: input.marketEvidence?.summary,
        deepTags: input.deepAnalysis?.learningTags ?? [],
        rootCause: input.deepAnalysis?.rootCause,
      } as Prisma.InputJsonValue,
      lastSeenAt: input.closedAt ?? new Date(),
    },
  });
  const patch = await upsertPolicyPatch(
    {
      ...input,
      learningWeight: learningWeightProfile.weight,
      learningWeightProfile,
      numericFeatures: enrichedNumericFeatures,
      metadata: enrichedMetadata,
    },
    stats,
  );
  return { learningTrade, marketEvidence, stats: persistedStats, policyPatch: patch };
}

export async function getLearningOverview() {
  const [tradeCount, patternCount, policyCount, topPatterns, riskyPatterns, activePolicies, recentDeepTrades] = await Promise.all([
    db.learningTrade.count(),
    db.learningPatternStats.count(),
    db.learningPolicyPatch.count({ where: { status: { in: ["LIVE_ADVISORY", "LIVE_ACTIVE"] } } }),
    db.learningPatternStats.findMany({ orderBy: [{ confidenceScore: "desc" }, { expectancyPercent: "desc" }], take: 10 }),
    db.learningPatternStats.findMany({ where: { losses: { gt: 0 } }, orderBy: [{ maxDrawdownPercent: "desc" }], take: 10 }),
    db.learningPolicyPatch.findMany({ where: { status: { in: ["LIVE_ADVISORY", "LIVE_ACTIVE"] } }, orderBy: { updatedAt: "desc" }, take: 20 }),
    db.learningTrade.findMany({ orderBy: { closedAt: "desc" }, take: 50 }),
  ]);
  const deepAnalysis = summarizeDeepAnalyses(recentDeepTrades);
  const marketEvidence = summarizeMarketEvidence(recentDeepTrades);
  const calibration = calibrationSummary(recentDeepTrades);
  return {
    tradeCount,
    patternCount,
    livePolicyCount: policyCount,
    topPatterns,
    riskyPatterns,
    activePolicies,
    deepAnalysis,
    marketEvidence,
    calibration,
    updatedAt: new Date().toISOString(),
  };
}

export async function listLearningPatterns(limit = 100) {
  const patterns = await db.learningPatternStats.findMany({
    orderBy: [{ status: "asc" }, { confidenceScore: "desc" }, { sampleCount: "desc" }],
    take: Math.max(1, Math.min(300, limit)),
  });
  const patternKeys = patterns.map((row) => String(row.patternKey ?? "")).filter(Boolean);
  const trades = patternKeys.length > 0
    ? await db.learningTrade.findMany({
        where: { patternKey: { in: patternKeys } },
        orderBy: { closedAt: "desc" },
        take: Math.max(50, patternKeys.length * 8),
      })
    : [];
  return patterns.map((pattern) => ({
    ...pattern,
    deepAnalysis: summarizeDeepAnalyses(
      trades.filter((trade) => String(trade.patternKey ?? "") === String(pattern.patternKey ?? "")),
    ),
    marketEvidence: summarizeMarketEvidence(
      trades.filter((trade) => String(trade.patternKey ?? "") === String(pattern.patternKey ?? "")),
    ),
  }));
}

export async function listLearningPolicyPatches(limit = 100) {
  return db.learningPolicyPatch.findMany({
    orderBy: { updatedAt: "desc" },
    take: Math.max(1, Math.min(300, limit)),
  });
}

export async function getLearningCalibration(limit = 500) {
  const trades = await db.learningTrade.findMany({
    orderBy: { closedAt: "desc" },
    take: Math.max(20, Math.min(1000, limit)),
  });
  return calibrationSummary(trades);
}

export async function getLiveLearningPolicy(patternKey: string) {
  return db.learningPolicyPatch.findFirst({
    where: {
      patternKey,
      status: { in: ["LIVE_ADVISORY", "LIVE_ACTIVE"] },
    },
    orderBy: { confidenceScore: "desc" },
  });
}

export async function getCrossModeLearningPolicy(patternKey: string) {
  return db.learningPolicyPatch.findFirst({
    where: {
      patternKey,
      status: { in: ["PAPER_VALIDATED", "LIVE_ADVISORY", "LIVE_ACTIVE"] },
      sampleCount: { gte: Math.max(1, env.EXECUTION_ADAPTIVE_MIN_TRADES) },
    },
    orderBy: [{ status: "desc" }, { confidenceScore: "desc" }, { updatedAt: "desc" }],
  });
}

export async function getImmediateLearningRiskPolicy(patternKey: string) {
  const policy = await db.learningPolicyPatch.findFirst({
    where: {
      patternKey,
      status: { not: "DISABLED" },
      sampleCount: { gte: 1 },
    },
    orderBy: [{ updatedAt: "desc" }, { confidenceScore: "desc" }],
  });
  if (!policy) return null;
  const metadata = jsonObject(policy.metadata);
  const deep = jsonObject(metadata.deepAnalysis);
  const recommendation = String(deep.policyRecommendation ?? "").toUpperCase();
  const quality = String(deep.tradeQuality ?? "").toUpperCase();
  const aiVerdict = String(deep.aiVerdict ?? "").toUpperCase();
  const learningTags = Array.isArray(deep.learningTags) ? deep.learningTags.map((tag) => String(tag).toLowerCase()) : [];
  const rootCause = String(deep.rootCause ?? "").toLowerCase();
  const lowerPatternKey = patternKey.toLowerCase();
  const rejectedSetup =
    lowerPatternKey.includes("quality:reject") ||
    lowerPatternKey.includes("confirm:rejected");
  const momentumRisk =
    lowerPatternKey.includes("momentum_breakout:yes") ||
    learningTags.includes("momentum_breakout:yes") ||
    rootCause.includes("momentum");
  const confirmedRisk = aiVerdict === "CONFIRMED_RISK";
  const dangerousBlock = recommendation === "BLOCK" && quality === "DANGEROUS";
  const riskyTighten =
    (recommendation === "BLOCK" || recommendation === "TIGHTEN") &&
    (quality === "DANGEROUS" || quality === "WEAK") &&
    (rejectedSetup || momentumRisk || confirmedRisk);
  if (!dangerousBlock && !riskyTighten) return null;
  return policy;
}

export function resolveImmediateLearningRiskAdjustment(policy: Record<string, unknown> | null | undefined) {
  if (!policy) return { allowed: true, minScoreDelta: 0, sizeMultiplier: 1, reason: "no-immediate-learning-risk" };
  const metadata = jsonObject(policy.metadata);
  const deep = jsonObject(metadata.deepAnalysis);
  const recommendation = String(deep.policyRecommendation ?? "").toUpperCase();
  const quality = String(deep.tradeQuality ?? "").toUpperCase();
  const rootCause = String(deep.rootCause ?? policy.reason ?? "learning risk pattern");
  if (recommendation === "BLOCK" && quality === "DANGEROUS") {
    return {
      allowed: false,
      minScoreDelta: 15,
      sizeMultiplier: 0,
      reason: `immediate-learning-block: quality=${quality}, policy=${recommendation}, root=${rootCause.slice(0, 160)}`,
    };
  }
  return {
    allowed: true,
    minScoreDelta: recommendation === "BLOCK" ? 12 : 8,
    sizeMultiplier: recommendation === "BLOCK" ? 0.35 : 0.55,
    reason: `immediate-learning-tighten: quality=${quality}, policy=${recommendation}, root=${rootCause.slice(0, 160)}`,
  };
}

export function resolveAdaptiveAdjustment(policy: Record<string, unknown> | null | undefined, options?: { liveGuard?: boolean }) {
  if (!policy) return { allowed: true, minScoreDelta: 0, sizeMultiplier: 1, reason: "no-learning-policy" };
  const action = String(policy.action ?? "");
  const status = String(policy.status ?? "");
  const sampleCount = finite(policy.sampleCount, 0);
  const confidenceScore = finite(policy.confidenceScore, 0);
  const crossModeBlock =
    Boolean(options?.liveGuard) &&
    action === "TIGHTEN_OR_BLOCK" &&
    sampleCount >= env.EXECUTION_ADAPTIVE_MIN_TRADES &&
    confidenceScore >= 45;
  if ((action === "TIGHTEN_OR_BLOCK" && status === "LIVE_ACTIVE") || crossModeBlock) {
    return {
      allowed: false,
      minScoreDelta: finite(policy.minScoreDelta, 8),
      sizeMultiplier: 0,
      reason: String(policy.reason ?? "learning policy blocked pattern"),
    };
  }
  return {
    allowed: true,
    minScoreDelta: finite(policy.minScoreDelta, 0),
    sizeMultiplier: finite(policy.sizeMultiplier, 1),
    suggestedTakeProfitPercent: optionalFinite(policy.suggestedTakeProfitPercent),
    suggestedStopLossPercent: optionalFinite(policy.suggestedStopLossPercent),
    suggestedMaxDurationSec: optionalFinite(policy.suggestedMaxDurationSec),
    reason: String(policy.reason ?? "learning policy advisory"),
  };
}

function sideFromPosition(value: unknown): "BUY" | "SELL" {
  return String(value ?? "").toUpperCase() === "SHORT" ? "SELL" : "BUY";
}

function resolveOutcome(returnPercent: number): "WIN" | "LOSS" | "BREAKEVEN" {
  if (returnPercent > 0.05) return "WIN";
  if (returnPercent < -0.05) return "LOSS";
  return "BREAKEVEN";
}

function fallbackCritic(outcome: "WIN" | "LOSS" | "BREAKEVEN", deepAnalysis: DeepPostTradeAnalysis): PostTradeCritic {
  return {
    grade: outcome === "WIN" ? "B" : outcome === "BREAKEVEN" ? "C" : "D",
    verdict: deepAnalysis.policyRecommendation === "BLOCK" ? "PAUSE_SETUP" : deepAnalysis.policyRecommendation === "TIGHTEN" ? "TIGHTEN_FILTERS" : "KEEP_TESTING",
    summary: deepAnalysis.rootCause,
    lessons: deepAnalysis.learningTags.slice(0, 6),
    nextActions: deepAnalysis.nextSetupRules,
  };
}

function fallbackTpsl(horizon: TradeLearningHorizon, deepAnalysis: DeepPostTradeAnalysis): TpslOptimizationSuggestion {
  const horizonDefaults: Record<TradeLearningHorizon, { takeProfitPercent: number; maxDurationSec: number }> = {
    SCALP_5M: { takeProfitPercent: 0.8, maxDurationSec: 300 },
    INTRADAY_15M: { takeProfitPercent: 1.0, maxDurationSec: 900 },
    SHORT_30M: { takeProfitPercent: 1.2, maxDurationSec: 1800 },
    INTRADAY_1H: { takeProfitPercent: 1.8, maxDurationSec: 3600 },
    INTRADAY_4H: { takeProfitPercent: 3.5, maxDurationSec: 14400 },
    SESSION: { takeProfitPercent: 5, maxDurationSec: 43200 },
  };
  const defaults = horizonDefaults[horizon];
  return {
    horizon,
    suggestedTakeProfitPercent: defaults.takeProfitPercent,
    suggestedStopLossPercent: deepAnalysis.policyRecommendation === "BLOCK" ? 0.45 : 0.75,
    suggestedMaxDurationSec: defaults.maxDurationSec,
    confidence: deepAnalysis.confidence,
    reason: deepAnalysis.rootCause,
  };
}

export async function runLearningBackfill(limit = 10) {
  const existing = await db.learningTrade.findMany({ orderBy: { closedAt: "desc" }, take: 1000 });
  const existingPositionIds = new Set(existing.map((row) => String(row.positionId ?? "")).filter(Boolean));
  const positions = await db.position.findMany({
    where: {
      status: "CLOSED",
      id: { notIn: Array.from(existingPositionIds) },
      closedAt: { not: null },
    },
    include: { tradingPair: true },
    orderBy: { closedAt: "desc" },
    take: Math.max(1, Math.min(50, limit)),
  });
  const processed: Array<Record<string, unknown>> = [];
  for (const position of positions) {
    const metadata = jsonObject(position.metadata);
    const setupSnapshot = buildSetupFeatureSnapshot(metadata);
    const entryPrice = finite(position.entryPrice);
    const exitPrice = finite(position.closePrice ?? position.markPrice ?? position.entryPrice);
    const returnPercent = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * (sideFromPosition(position.side) === "BUY" ? 100 : -100) : finite(position.realizedPnl);
    const outcome = resolveOutcome(returnPercent);
    const tradingPair = jsonObject(position.tradingPair);
    const marketEvidence = await collectLearningMarketEvidence(String(tradingPair.symbol ?? metadata.symbol ?? ""));
    const numericFeatures = setupSnapshot.numericFeatures;
    const strategy = `${setupSnapshot.marketRegimeStrategy ?? "BACKFILL"}:${setupSnapshot.horizon}`;
    const historicalRegimeExpectancy = await getHistoricalStrategyRegimeExpectancy({
      strategy,
      marketRegime: setupSnapshot.marketRegime,
    }).catch(() => undefined);
    const deepAnalysis = await runDeepPostTradeAnalysis({
      symbol: marketEvidence.symbol,
      side: sideFromPosition(position.side),
      strategy,
      entryLogic: setupSnapshot.entryType,
      outcome,
      entryPrice,
      exitPrice,
      returnPercent,
      realizedPnl: finite(position.realizedPnl),
      targetProfitPercent: optionalFinite(metadata.takeProfitPercent ?? metadata.targetProfitPercent),
      stopLossPercent: optionalFinite(metadata.stopLossPercent),
      maxDurationSec: optionalFinite(metadata.maxDurationSec),
      holdSec: position.openedAt && position.closedAt ? Math.max(0, Math.round((new Date(String(position.closedAt)).getTime() - new Date(String(position.openedAt)).getTime()) / 1000)) : undefined,
      closeReason: String(metadata.closeReason ?? "BACKFILL"),
      marketRegime: setupSnapshot.marketRegime,
      historicalRegimeExpectancyPercent: historicalRegimeExpectancy?.expectancyPercent,
      qualityScore: setupSnapshot.qualityScore,
      features: setupSnapshot.features,
      numericFeatures,
      marketEvidence,
      metadata,
    });
    const result = await persistLearningTrade({
      userId: String(position.userId),
      tradingPairId: String(position.tradingPairId),
      positionId: String(position.id),
      tradeId: String(position.id),
      symbol: marketEvidence.symbol,
      mode: String(metadata.mode ?? "paper"),
      side: sideFromPosition(position.side),
      strategy,
      horizon: setupSnapshot.horizon,
      outcome,
      entryPrice,
      exitPrice,
      quantity: finite(position.quantity),
      realizedPnl: finite(position.realizedPnl),
      returnPercent,
      targetProfitPercent: optionalFinite(metadata.takeProfitPercent ?? metadata.targetProfitPercent),
      stopLossPercent: optionalFinite(metadata.stopLossPercent),
      maxDurationSec: optionalFinite(metadata.maxDurationSec),
      marketRegime: setupSnapshot.marketRegime,
      qualityScore: setupSnapshot.qualityScore,
      patternKey: setupSnapshot.patternKey,
      features: [...setupSnapshot.features, ...deepAnalysis.learningTags.map((tag) => `deep:${tag}`)],
      numericFeatures,
      critic: fallbackCritic(outcome, deepAnalysis),
      tpslSuggestion: fallbackTpsl(setupSnapshot.horizon, deepAnalysis),
      deepAnalysis,
      marketEvidence,
      metadata: { setupSnapshot, deepAnalysis, marketEvidence, backfill: true },
      openedAt: position.openedAt ? new Date(String(position.openedAt)) : undefined,
      closedAt: position.closedAt ? new Date(String(position.closedAt)) : undefined,
    });
    processed.push({ positionId: position.id, learningTradeId: result.learningTrade.id, outcome, returnPercent });
  }
  return { processedCount: processed.length, processed, updatedAt: new Date().toISOString() };
}
