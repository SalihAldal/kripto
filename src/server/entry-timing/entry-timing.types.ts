import type {
  EntryFilterReason,
  EntryTimingJobType,
  EntryVerdict,
  SpotEntryType,
  WaitDuration,
} from "@prisma/client";

export type EntryTimingJobPayload =
  | { type: "ANALYZE_ENTRY"; symbol?: string; price?: number }
  | { type: "CONFIRM_ENTRY"; analysisId?: string }
  | { type: "FILTER_CHECK"; analysisId?: string }
  | { type: "WAIT_REEVALUATE" }
  | { type: "QUALITY_SCORE"; analysisId?: string }
  | { type: "REPLAY_ENTRY"; symbol?: string; limit?: number }
  | { type: "LEARN_PATTERNS" }
  | { type: "HEATMAP_BUILD" }
  | { type: "RECOMMENDATION"; analysisId?: string; symbol?: string };

export type EntryContext = {
  symbol: string;
  price: number;
  trend: { score: number; direction: string; strength: number };
  momentum: { score: number; breakoutProb: number; shortMomentum: number };
  volume: { score: number; relativeVolume: number; delta: number };
  liquidity: { score: number; spread: number; imbalance: number };
  orderBook: { score: number; bidAskRatio: number };
  volatility: { score: number; atr: number; realized: number };
  support: { score: number; distancePct: number };
  resistance: { score: number; distancePct: number };
  structure: { score: number; regime: string };
  regime: { score: number; label: string };
  news: { score: number; uncertainty: number };
  whale: { score: number; activity: number };
  onChain: { score: number };
  exchange: { stable: boolean; latencyMs: number };
};

export type MicroStructureAnalysis = {
  microTrend: "BULLISH" | "BEARISH" | "NEUTRAL";
  swingHigh: number | null;
  swingLow: number | null;
  higherHigh: boolean;
  higherLow: boolean;
  lowerHigh: boolean;
  lowerLow: boolean;
  bos: boolean;
  choch: boolean;
  volumeExpansion: boolean;
  volumeContraction: boolean;
  signals: string[];
};

export type EntryConfirmation = {
  entryScore: number;
  entryConfidence: number;
  entryRisk: number;
  breakoutProbability: number;
  continuationProbability: number;
  pullbackProbability: number;
  fakeBreakoutProbability: number;
  reversalProbability: number;
};

export type EntryFilterResult = {
  passed: boolean;
  reasons: EntryFilterReason[];
  rejectMessages: string[];
};

export type EntryQualityResult = {
  qualityScore: number;
  expectedRr: number;
  expectedSuccess: number;
  expectedHoldMinutes: number;
  expectedVolatility: number;
};

export const WAIT_DURATION_MS: Record<WaitDuration, number> = {
  MINUTES_5: 5 * 60_000,
  MINUTES_15: 15 * 60_000,
  MINUTES_30: 30 * 60_000,
  HOUR_1: 60 * 60_000,
};

export const ENTRY_TIMING_EVENT = {
  ANALYSIS_COMPLETED: "EntryAnalysisCompleted",
  VERDICT_BUY: "EntryVerdictBuy",
  VERDICT_WAIT: "EntryVerdictWait",
  VERDICT_REJECT: "EntryVerdictReject",
  REPLAY_COMPLETED: "EntryReplayCompleted",
  PATTERN_LEARNED: "EntryPatternLearned",
  RECOMMENDATION_PUBLISHED: "EntryRecommendationPublished",
  REEVALUATION_TRIGGERED: "EntryReevaluationTriggered",
} as const;

export type { EntryFilterReason, EntryTimingJobType, EntryVerdict, SpotEntryType, WaitDuration };
