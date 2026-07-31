import type { IndicatorSnapshot } from "@/src/server/trading-core/core/types";
import type { MarketEdgeCondition } from "@/src/server/trading-core/market-edge";
import type { DynamicLearningWeight } from "@/src/server/trading-core/self-learning/dynamic-learning-weight";
import type { RegimeCompatibilityAnalysis } from "@/src/server/trading-core/self-learning/regime-mismatch-detector";

export type LearningOutcome = "WIN" | "LOSS" | "BREAKEVEN";
export type LearnedPatternStatus = "BOOSTED" | "NEUTRAL" | "BLACKLISTED";

export type TradeLearningInput = {
  tradeId: string;
  botId: string;
  strategy: string;
  symbol: string;
  side: "BUY" | "SELL";
  realizedPnl: number;
  returnPercent: number;
  entryPrice?: number;
  exitPrice?: number;
  maxDurationSec?: number;
  targetProfitPercent?: number;
  stopLossPercent?: number;
  qualityScore?: number;
  marketRegime?: string;
  regimeCompatibility?: RegimeCompatibilityAnalysis;
  learningWeight?: number;
  learningWeightProfile?: DynamicLearningWeight;
  indicators?: IndicatorSnapshot;
  reasons?: string[];
  edgeConditions?: MarketEdgeCondition[];
  openedAt?: string;
  closedAt?: string;
};

export type LearnedPattern = {
  patternKey: string;
  strategy: string;
  marketRegime?: string;
  indicatorTags: string[];
  trades: number;
  wins: number;
  losses: number;
  winrate: number;
  averageReturnPercent: number;
  weightedSampleCount?: number;
  weightedWinrate?: number;
  weightedAverageReturnPercent?: number;
  averageLearningWeight?: number;
  lastLearningWeight?: number;
  regimeCompatibility?: RegimeCompatibilityAnalysis;
  score: number;
  status: LearnedPatternStatus;
  lastSeenAt: string;
};

export type IndicatorImpact = {
  indicator: string;
  wins: number;
  losses: number;
  winrate: number;
  averageReturnPercent: number;
  impactScore: number;
};

export type StrategyLearningPatch = {
  strategy: string;
  previousMinScore: number;
  nextMinScore: number;
  reason: string;
};

export type PostTradeCritic = {
  grade: "A" | "B" | "C" | "D" | "F";
  verdict: "SCALE_UP" | "KEEP_TESTING" | "TIGHTEN_FILTERS" | "PAUSE_SETUP";
  summary: string;
  lessons: string[];
  nextActions: string[];
};

export type TradeLearningHorizon = "SCALP_5M" | "INTRADAY_15M" | "SHORT_30M" | "INTRADAY_1H" | "INTRADAY_4H" | "SESSION";

export type TpslOptimizationSuggestion = {
  horizon: TradeLearningHorizon;
  suggestedTakeProfitPercent: number;
  suggestedStopLossPercent: number;
  suggestedMaxDurationSec: number;
  confidence: number;
  reason: string;
};

export type DeepPostTradeAnalysis = {
  professionalSummary: string;
  rootCause: string;
  rootCauseFactors: string[];
  marketRead: {
    volume: string;
    orderbook: string;
    flow: string;
    momentumBreakout: string;
    mtf: string;
    volatility: string;
    manipulation: string;
  };
  entryMistake: string;
  exitMistake: string;
  riskMistake: string;
  learningTags: string[];
  policyRecommendation: "BLOCK" | "TIGHTEN" | "KEEP_TESTING" | "BOOST";
  nextSetupRules: string[];
  tradeQuality: "CLEAN" | "ACCEPTABLE" | "WEAK" | "DANGEROUS";
  aiVerdict: "CONFIRMED_RISK" | "CONFLICTED" | "SUPPORTIVE" | "NOT_AVAILABLE";
  confidence: number;
  deterministicScore: number;
  aiSummary: string;
  regimeCompatibility?: RegimeCompatibilityAnalysis;
  generatedAt: string;
  source: "AI_AND_RULES" | "RULES_ONLY";
};

export type TradeLearningReport = {
  tradeId: string;
  outcome: LearningOutcome;
  winLossReasons: string[];
  pattern: LearnedPattern;
  indicatorImpact: IndicatorImpact[];
  strategyPatch?: StrategyLearningPatch;
  postTradeCritic: PostTradeCritic;
  learningWeight?: DynamicLearningWeight;
  tpslSuggestion: TpslOptimizationSuggestion;
  blacklistedPatterns: LearnedPattern[];
  boostedPatterns: LearnedPattern[];
  generatedAt: string;
};

export type SelfLearningSnapshot = {
  patterns: LearnedPattern[];
  indicatorImpact: IndicatorImpact[];
  blacklistedPatterns: LearnedPattern[];
  boostedPatterns: LearnedPattern[];
  updatedAt: string;
};
