import type { ShadowEngineMode, ShadowDecisionVerdict, ValidationReportCadence } from "@prisma/client";

export type ShadowEngineAdapterId =
  | "production-mirror"
  | "decision-engine-v1"
  | "decision-engine-v2"
  | "legacy-hybrid"
  | "momentum-heuristic"
  | "experimental-ai"
  | "research-ai"
  | "institutional-ai";

export type ShadowEngineDefinition = {
  engineId: string;
  name: string;
  version: string;
  mode: ShadowEngineMode;
  enabled: boolean;
  trafficPct: number;
  adapter: ShadowEngineAdapterId;
  metadata?: Record<string, unknown>;
};

export type ShadowDecisionCapture = {
  decisionId: string;
  symbol: string;
  engineId: string;
  engineMode: ShadowEngineMode;
  decision: string;
  confidence?: number;
  entryPrice?: number;
  targetPrice?: number;
  stopPrice?: number;
  reasoning?: string;
  payload?: Record<string, unknown>;
  productionDecision?: string;
  isProduction?: boolean;
};

export type DecisionComparisonResult = {
  decisionId: string;
  symbol: string;
  productionEngineId: string;
  shadowEngineId: string;
  productionDecision: string;
  shadowDecision: string;
  confidenceDelta?: number;
  reasoningDelta?: string;
  disagreements?: string[];
  expertConflicts?: Array<{ expert: string; productionView: string; shadowView: string }>;
  profitDeltaPct?: number;
  winnerEngineId?: string;
};

export type EngineScorecard = {
  engineId: string;
  winRate: number;
  lossRate: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdownPct: number;
  avgProfitPct: number;
  avgLossPct: number;
  avgHoldingMin: number;
  expectancy: number;
  avgRiskReward: number;
  tradeFrequency: number;
  missedWinners: number;
  falseRejects: number;
  falseEntries: number;
  completedTrades: number;
  rejectAccuracy?: number;
  decisionStability?: number;
  replayAccuracy?: number;
};

export type PromotionRules = {
  minCompletedTrades: 1000;
  minProfitFactor: 1.5;
  minExpectancy: 0;
  minSharpe: 1;
  maxDrawdownPct: 10;
  minWinRate: 55;
  minRejectAccuracy: 80;
  minDecisionStability: 85;
  minReplayAccuracy: 80;
};

export const PROMOTION_RULES: PromotionRules = {
  minCompletedTrades: 1000,
  minProfitFactor: 1.5,
  minExpectancy: 0,
  minSharpe: 1,
  maxDrawdownPct: 10,
  minWinRate: 55,
  minRejectAccuracy: 80,
  minDecisionStability: 85,
  minReplayAccuracy: 80,
};

export type ShadowValidationJobPayload =
  | { type: "SHADOW_CAPTURE"; decisionId: string }
  | { type: "SHADOW_EVALUATE"; decisionId?: string; limit?: number }
  | { type: "REPLAY_VALIDATE"; decisionId?: string; limit?: number }
  | { type: "SIMULATION_RUN"; windowDays?: 30 | 90 | 180 | 365; engineIds?: string[] }
  | { type: "DAILY_COMPARISON" }
  | { type: "WEEKLY_BENCHMARK" }
  | { type: "MONTHLY_VALIDATION" }
  | { type: "PROMOTION_CHECK"; engineId?: string };

export type EvaluationVerdict = ShadowDecisionVerdict;

export const SIMULATION_WINDOWS = [30, 90, 180, 365] as const;

export const DEFAULT_SHADOW_ENGINES: ShadowEngineDefinition[] = [
  { engineId: "production", name: "Production Engine", version: "live", mode: "PRODUCTION", enabled: true, trafficPct: 100, adapter: "production-mirror" },
  { engineId: "decision-engine-v1", name: "Decision Engine V1", version: "1.0.0", mode: "SHADOW", enabled: true, trafficPct: 100, adapter: "decision-engine-v1" },
  { engineId: "decision-engine-v2", name: "Decision Engine V2 ML", version: "2.0.0", mode: "SHADOW", enabled: true, trafficPct: 100, adapter: "decision-engine-v2" },
  { engineId: "legacy-hybrid", name: "Legacy Hybrid", version: "1.0.0", mode: "SHADOW", enabled: true, trafficPct: 100, adapter: "legacy-hybrid" },
  { engineId: "momentum-heuristic", name: "Momentum Engine", version: "1.0.0", mode: "SHADOW", enabled: true, trafficPct: 100, adapter: "momentum-heuristic" },
  { engineId: "experimental-ai", name: "Experimental AI", version: "0.1.0", mode: "SHADOW", enabled: true, trafficPct: 10, adapter: "experimental-ai" },
  { engineId: "research-ai", name: "Research AI", version: "0.1.0", mode: "SIMULATION", enabled: true, trafficPct: 0, adapter: "research-ai" },
  { engineId: "institutional-ai", name: "Institutional AI", version: "0.1.0", mode: "SHADOW", enabled: true, trafficPct: 50, adapter: "institutional-ai" },
];
