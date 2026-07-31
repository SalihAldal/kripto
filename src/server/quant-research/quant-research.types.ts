import type {
  BenchmarkType,
  MarketRegimeType,
  PromotionStatus,
  QuantResearchJobType,
  ResearchReportCadence,
  ResearchRunStatus,
  StrategyArchetype,
} from "@prisma/client";

export type QuantResearchJobPayload =
  | { type: "RESEARCH_RUN"; projectId?: string; windowDays?: number }
  | { type: "STRATEGY_GENERATE"; count?: number; archetypes?: StrategyArchetype[] }
  | { type: "INDICATOR_GENERATE"; count?: number }
  | { type: "PARAMETER_OPTIMIZE"; genomeId?: string; limit?: number }
  | { type: "BACKTEST"; genomeId?: string; windowDays?: number; projectId?: string }
  | { type: "WALK_FORWARD"; genomeId?: string; folds?: number; windowDays?: number }
  | { type: "MONTE_CARLO"; genomeId?: string; iterations?: number; windowDays?: number }
  | { type: "REGIME_BENCHMARK"; genomeId?: string; windowDays?: number }
  | { type: "STRATEGY_COMPETITION"; windowDays?: number }
  | { type: "STRATEGY_EVOLVE"; generation?: number; survivors?: number }
  | { type: "FEATURE_SELECT"; windowDays?: number }
  | { type: "INSTITUTIONAL_BENCHMARK"; genomeId?: string; windowDays?: number }
  | { type: "RESEARCH_REPORT"; cadence?: ResearchReportCadence; date?: string }
  | { type: "SELF_DISCOVERY" }
  | { type: "KNOWLEDGE_SYNC"; limit?: number }
  | { type: "EXPERIMENT_RUN"; strategyType?: StrategyArchetype; name?: string; author?: string; windowDays?: number }
  | { type: "COUNTERFACTUAL_ANALYZE"; experimentId?: string; limit?: number; windowDays?: number }
  | { type: "WALK_FORWARD_VALIDATE"; experimentId?: string; genomeId?: string; folds?: number; windowDays?: number; modes?: import("@prisma/client").WalkForwardMode[] }
  | { type: "STRATEGY_BENCHMARK"; experimentId?: string; windowDays?: number; limit?: number }
  | { type: "FEATURE_RESEARCH"; experimentId?: string; windowDays?: number }
  | { type: "FEATURE_ELIMINATE"; experimentId?: string; windowDays?: number }
  | { type: "STATISTICAL_VALIDATE"; experimentId?: string; windowDays?: number }
  | { type: "RECOMMENDATION_GENERATE"; experimentId?: string }
  | { type: "HYPOTHESIS_GENERATE"; limit?: number };

export const BACKTEST_WINDOWS = [30, 90, 180, 365, 0] as const;
export type BacktestWindow = (typeof BACKTEST_WINDOWS)[number];

export const PROMOTION_RULES = {
  minSimulatedTrades: 5000,
  minProfitFactor: 1.8,
  minExpectancy: 0,
  minSharpe: 1.5,
  maxDrawdownPct: 8,
  minRejectAccuracy: 85,
  minReplayAccuracy: 85,
  minOutperformDays: 90,
} as const;

export type PerformanceMetrics = {
  tradeCount: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  maxDrawdownPct: number;
  recoveryFactor: number;
  ulcerIndex: number;
  omega: number;
  alpha: number;
  beta: number;
  totalReturnPct: number;
  avgReturnPct: number;
};

export type StrategyGenomeSpec = {
  genomeKey: string;
  name: string;
  archetype: StrategyArchetype;
  generation: number;
  indicators: string[];
  parameters: Record<string, number>;
  rules: Record<string, unknown>;
  parentGenome?: string;
};

export type RegimeBenchmarkResult = {
  regime: MarketRegimeType;
  tradeCount: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
};

export type CompetitionEntry = {
  genomeId: string;
  name: string;
  archetype: StrategyArchetype;
  rank: number;
  score: number;
  metrics: PerformanceMetrics;
};

export const QUANT_RESEARCH_EVENT = {
  PROJECT_STARTED: "ResearchProjectStarted",
  RUN_COMPLETED: "ResearchRunCompleted",
  STRATEGY_GENERATED: "StrategyGenerated",
  BACKTEST_COMPLETED: "BacktestCompleted",
  EVOLUTION_GENERATION: "EvolutionGeneration",
  PROMOTION_EVALUATED: "PromotionEvaluated",
  REPORT_GENERATED: "ResearchReportGenerated",
  SELF_DISCOVERY: "SelfDiscoveryQuestion",
  EXPERIMENT_COMPLETED: "ResearchExperimentCompleted",
  RECOMMENDATION_GENERATED: "ResearchRecommendationGenerated",
} as const;

export type { BenchmarkType, MarketRegimeType, PromotionStatus, QuantResearchJobType, ResearchReportCadence, ResearchRunStatus, StrategyArchetype };
