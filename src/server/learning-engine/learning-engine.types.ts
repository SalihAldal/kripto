import type { LearningEngineJobType, LearningMemoryType, PatternLibraryStatus } from "@prisma/client";

export type LearningEngineJobPayload =
  | { type: "DECISION_LEARN"; decisionId?: string; limit?: number }
  | { type: "TRADE_LEARN"; tradeId?: string; limit?: number }
  | { type: "REJECT_LEARN"; limit?: number }
  | { type: "MISSED_OPPORTUNITY_LEARN"; limit?: number }
  | { type: "FALSE_POSITIVE_LEARN"; limit?: number }
  | { type: "PATTERN_DISCOVERY"; limit?: number }
  | { type: "FEATURE_IMPORTANCE"; periodHours?: number }
  | { type: "WEIGHT_RECOMMENDATION" }
  | { type: "DAILY_AI_REPORT"; date?: string }
  | { type: "WEEKLY_RESEARCH"; weekStart?: string }
  | { type: "KNOWLEDGE_BUILD"; limit?: number }
  | { type: "CONFIDENCE_CALIBRATION"; periodHours?: number }
  | { type: "RESEARCH_LAB"; ideaId?: string }
  | { type: "MEMORY_SYNC"; memoryType?: LearningMemoryType };

export type DecisionLearningRecord = {
  decisionId: string;
  symbol: string;
  decision: string;
  confidence?: number;
  reasoning?: string;
  expertOpinions?: unknown;
  scannerProfile?: unknown;
  marketSnapshot?: unknown;
  outcome?: string;
  learningSummary?: string;
};

export type TradeLearningRecord = {
  tradeId: string;
  symbol: string;
  entryQuality?: number;
  exitQuality?: number;
  timingScore?: number;
  riskScore?: number;
  rewardScore?: number;
  executionScore?: number;
  regime?: string;
  slippagePct?: number;
  features?: Record<string, number>;
};

export type RejectLearningVerdict = {
  decisionId: string;
  wasCorrect: boolean;
  missedProfitPct?: number;
  avoidedLossPct?: number;
  verdict: string;
};

export type MissedOpportunityType =
  | "BREAKOUT"
  | "PUMP"
  | "TREND_START"
  | "CONTINUATION"
  | "NEWS"
  | "WHALE"
  | "LIQUIDATION_CASCADE";

export type FalsePositiveType =
  | "BAD_BUY"
  | "BAD_SELL"
  | "BAD_HOLD"
  | "BAD_REJECT"
  | "FALSE_MOMENTUM"
  | "FALSE_BREAKOUT"
  | "FAKE_PUMP";

export type PatternDiscoveryResult = {
  patternKey: string;
  winRate: number;
  sampleSize: number;
  expectancy: number;
  regime?: string;
  hourBucket?: number;
  weekday?: number;
  status: PatternLibraryStatus;
};

export type FeatureImportanceRow = {
  feature: string;
  importance: number;
  direction: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  sampleSize: number;
};

export type WeightSuggestionRow = {
  feature: string;
  currentWeight: number;
  suggestedWeight: number;
  expectedWinRateDelta?: number;
  expectedProfitFactorDelta?: number;
  confidence: number;
  rationale?: string;
};

export type ConfidenceCalibrationPoint = {
  predictedBin: string;
  predictedAvg: number;
  actualSuccessRate: number;
  count: number;
  calibrationError: number;
};

export const LEARNING_EVENT = {
  SESSION_STARTED: "LearningSessionStarted",
  SESSION_COMPLETED: "LearningSessionCompleted",
  PATTERN_DISCOVERED: "PatternDiscovered",
  KNOWLEDGE_ADDED: "KnowledgeAdded",
  REPORT_GENERATED: "ReportGenerated",
  WEIGHT_SUGGESTED: "WeightSuggested",
} as const;

export type { LearningEngineJobType, LearningMemoryType, PatternLibraryStatus };
