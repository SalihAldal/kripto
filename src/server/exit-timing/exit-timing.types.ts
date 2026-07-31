import type {
  ExitTimingJobType,
  ExitVerdict,
  HoldDuration,
  PartialExitPct,
  SpotExitType,
  TrailingMode,
} from "@prisma/client";

export type ExitTimingJobPayload =
  | { type: "ANALYZE_EXIT"; positionId?: string; symbol?: string }
  | { type: "PROFIT_PROTECTION"; positionId?: string }
  | { type: "EXIT_SCORE"; analysisId?: string }
  | { type: "HOLD_REEVALUATE" }
  | { type: "EXIT_QUALITY"; analysisId?: string }
  | { type: "REPLAY_EXIT"; symbol?: string; limit?: number }
  | { type: "LEARN_EXITS" }
  | { type: "RECOMMENDATION"; analysisId?: string }
  | { type: "POSITION_SCAN" };

export type ExitContext = {
  symbol: string;
  positionId?: string;
  entryPrice: number;
  currentPrice: number;
  currentProfitPct: number;
  currentLossPct: number;
  holdingMinutes: number;
  momentum: { score: number; decay: number };
  trend: { score: number; direction: string; exhaustion: number };
  volume: { score: number; relativeVolume: number; distribution: boolean };
  regime: { score: number; label: string };
  orderBook: { score: number; imbalance: number };
  liquidity: { score: number; spread: number };
  news: { score: number; reversalRisk: number };
  whale: { score: number; distribution: number };
  onChain: { score: number };
  volatility: { score: number; atr: number; realized: number };
  vwap: { distancePct: number };
  support: { score: number; distancePct: number; broken: boolean };
  resistance: { score: number; distancePct: number };
};

export type ProfitProtectionSnapshot = {
  lockedProfitPct: number;
  openProfitPct: number;
  maximumProfitPct: number;
  profitGivebackPct: number;
  drawdownFromPeakPct: number;
};

export type ExitScoreResult = {
  exitScore: number;
  exitConfidence: number;
  expectedRemainingUpside: number;
  expectedDownside: number;
  riskScore: number;
  continuationProbability: number;
  reversalProbability: number;
};

export type PartialExitArchitecture = {
  enabled: false;
  supportedPcts: PartialExitPct[];
  productionPct: PartialExitPct;
};

export type TrailingArchitecture = {
  enabled: false;
  modes: TrailingMode[];
  activeMode: TrailingMode;
};

export const HOLD_DURATION_MS: Record<HoldDuration, number> = {
  MINUTES_5: 5 * 60_000,
  MINUTES_15: 15 * 60_000,
  MINUTES_30: 30 * 60_000,
  HOUR_1: 60 * 60_000,
  HOURS_4: 4 * 60 * 60_000,
};

export const PARTIAL_EXIT_ARCH: PartialExitArchitecture = {
  enabled: false,
  supportedPcts: ["PCT_25", "PCT_50", "PCT_75", "PCT_100"],
  productionPct: "PCT_100",
};

export const TRAILING_ARCH: TrailingArchitecture = {
  enabled: false,
  modes: ["ATR_TRAILING", "DYNAMIC_TRAILING", "PERCENTAGE_TRAILING", "VOLATILITY_TRAILING"],
  activeMode: "DISABLED",
};

export const EXIT_TIMING_EVENT = {
  ANALYSIS_COMPLETED: "ExitAnalysisCompleted",
  VERDICT_SELL: "ExitVerdictSell",
  VERDICT_HOLD: "ExitVerdictHold",
  PROFIT_PROTECTION_UPDATED: "ProfitProtectionUpdated",
  REPLAY_COMPLETED: "ExitReplayCompleted",
  LEARNING_UPDATED: "ExitLearningUpdated",
  RECOMMENDATION_PUBLISHED: "ExitRecommendationPublished",
} as const;

export type { ExitTimingJobType, ExitVerdict, HoldDuration, PartialExitPct, SpotExitType, TrailingMode };
