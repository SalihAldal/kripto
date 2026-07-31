import type {
  AdaptiveRegimeLabel,
  CoinClassificationType,
  StrategySelectorJobType,
  StrategySelectorType,
} from "@prisma/client";

export type StrategySelectorJobPayload =
  | { type: "DETECT_REGIME"; symbol?: string }
  | { type: "CLASSIFY_COIN"; symbol: string }
  | { type: "SCORE_STRATEGIES"; symbol: string; regimeId?: string }
  | { type: "SELECT_STRATEGY"; symbol: string }
  | { type: "VALIDATE_SELECTION"; selectionId?: string }
  | { type: "REPLAY_STRATEGY"; symbol?: string; limit?: number }
  | { type: "BENCHMARK_STRATEGIES" }
  | { type: "LEARN_STRATEGIES" }
  | { type: "SWITCH_CHECK"; symbol?: string }
  | { type: "UPDATE_KNOWLEDGE" }
  | { type: "PERFORMANCE_SYNC" };

export type RegimeDetectionResult = {
  regimeLabel: AdaptiveRegimeLabel;
  regimeConfidence: number;
  bullScore: number;
  bearScore: number;
  rangeScore: number;
  volatilityScore: number;
  newsScore: number;
  whaleScore: number;
  evidence: Record<string, unknown>;
};

export type StrategyScore = {
  strategyType: StrategySelectorType;
  expectedWinRate: number;
  expectedProfitFactor: number;
  historicalAccuracy: number;
  currentCompatibility: number;
  marketCompatibility: number;
  confidence: number;
  totalScore: number;
};

export type StrategySelectionResult = {
  primaryStrategy: StrategySelectorType;
  secondaryStrategy: StrategySelectorType | null;
  rejectedStrategies: StrategySelectorType[];
  reasoningSummary: string;
  rankings: StrategyScore[];
};

export type StrategyConfidenceResult = {
  strategyConfidence: number;
  expectedSuccess: number;
  expectedRisk: number;
  expectedHoldMinutes: number;
  expectedVolatility: number;
};

export type ValidationResult = {
  passed: boolean;
  regimeConfidence: number;
  strategyConfidence: number;
  historicalSimilarity: number;
  compatibility: number;
  dataFreshness: number;
  details: string[];
};

export const STRATEGY_SELECTOR_EVENT = {
  REGIME_DETECTED: "StrategyRegimeDetected",
  STRATEGY_SELECTED: "StrategySelected",
  STRATEGY_SWITCH_RECOMMENDED: "StrategySwitchRecommended",
  REPLAY_COMPLETED: "StrategyReplayCompleted",
  BENCHMARK_GENERATED: "StrategyBenchmarkGenerated",
  KNOWLEDGE_UPDATED: "StrategyKnowledgeUpdated",
  VALIDATION_COMPLETED: "StrategyValidationCompleted",
} as const;

export type { AdaptiveRegimeLabel, CoinClassificationType, StrategySelectorJobType, StrategySelectorType };
