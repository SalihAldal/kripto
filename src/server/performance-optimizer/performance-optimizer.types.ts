import type { PerfOptJobType, PerfOptRecommendationTarget, PerfOptTimelinePeriod } from "@prisma/client";

export type PerfOptJobPayload =
  | { type: "DAILY_REVIEW"; date?: string }
  | { type: "MISSED_OPPORTUNITY"; limit?: number }
  | { type: "LATE_ENTRY_ANALYZE"; limit?: number }
  | { type: "EARLY_EXIT_ANALYZE"; limit?: number }
  | { type: "LATE_EXIT_ANALYZE"; limit?: number }
  | { type: "TRADE_QUALITY_SCORE"; limit?: number }
  | { type: "STRATEGY_RANKING" }
  | { type: "COIN_RANKING" }
  | { type: "MARKET_CONDITION_ANALYZE" }
  | { type: "GENERATE_RECOMMENDATIONS" }
  | { type: "PARAMETER_RECOMMENDATIONS" }
  | { type: "PAPER_LIVE_COMPARE" }
  | { type: "TIMELINE_UPDATE"; period?: PerfOptTimelinePeriod }
  | { type: "SUCCESS_METRICS" }
  | { type: "TRADE_ANALYZE"; limit?: number };

export const PERF_OPT_EVENT = {
  DAILY_REVIEW_COMPLETED: "PerfOptDailyReviewCompleted",
  MISSED_OPPORTUNITY_FOUND: "PerfOptMissedOpportunityFound",
  TRADE_QUALITY_SCORED: "PerfOptTradeQualityScored",
  RECOMMENDATION_GENERATED: "PerfOptRecommendationGenerated",
  RANKING_UPDATED: "PerfOptRankingUpdated",
  TIMELINE_UPDATED: "PerfOptTimelineUpdated",
  SUCCESS_METRICS_CALCULATED: "PerfOptSuccessMetricsCalculated",
} as const;

export type { PerfOptJobType, PerfOptRecommendationTarget, PerfOptTimelinePeriod };
