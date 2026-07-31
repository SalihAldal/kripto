import { runDailyPerformanceReview } from "@/src/server/performance-optimizer/daily-performance-review.service";
import { analyzeMissedOpportunities } from "@/src/server/performance-optimizer/missed-opportunity-analyzer.service";
import { analyzeLateEntries } from "@/src/server/performance-optimizer/late-entry-analyzer.service";
import { analyzeEarlyExits, analyzeLateExits } from "@/src/server/performance-optimizer/exit-optimization-analyzer.service";
import { scoreTradeQuality } from "@/src/server/performance-optimizer/trade-quality-scoring.service";
import { rankStrategyPerformance } from "@/src/server/performance-optimizer/strategy-performance-ranking.service";
import { rankCoinPerformance } from "@/src/server/performance-optimizer/coin-performance-ranking.service";
import { analyzeMarketConditionPerformance } from "@/src/server/performance-optimizer/market-condition-performance.service";
import { generateAiRecommendations, generateParameterRecommendations } from "@/src/server/performance-optimizer/ai-recommendation-engine.service";
import { comparePaperVsLive } from "@/src/server/performance-optimizer/paper-live-comparison.service";
import { updatePerformanceTimeline } from "@/src/server/performance-optimizer/performance-timeline.service";
import { calculateSuccessMetrics } from "@/src/server/performance-optimizer/success-metrics.service";
import type { PerfOptJobPayload } from "@/src/server/performance-optimizer/performance-optimizer.types";

export async function runPerfOptJob(payload: PerfOptJobPayload) {
  switch (payload.type) {
    case "DAILY_REVIEW":
      return runDailyPerformanceReview(payload.date ? new Date(payload.date) : new Date());
    case "MISSED_OPPORTUNITY":
      return analyzeMissedOpportunities(payload.limit ?? 20);
    case "LATE_ENTRY_ANALYZE":
      return analyzeLateEntries(payload.limit ?? 20);
    case "EARLY_EXIT_ANALYZE":
      return analyzeEarlyExits(payload.limit ?? 20);
    case "LATE_EXIT_ANALYZE":
      return analyzeLateExits(payload.limit ?? 20);
    case "TRADE_QUALITY_SCORE":
      return scoreTradeQuality(payload.limit ?? 30);
    case "STRATEGY_RANKING":
      return rankStrategyPerformance();
    case "COIN_RANKING":
      return rankCoinPerformance();
    case "MARKET_CONDITION_ANALYZE":
      return analyzeMarketConditionPerformance();
    case "GENERATE_RECOMMENDATIONS":
      return generateAiRecommendations();
    case "PARAMETER_RECOMMENDATIONS":
      return generateParameterRecommendations();
    case "PAPER_LIVE_COMPARE":
      return comparePaperVsLive();
    case "TIMELINE_UPDATE":
      return updatePerformanceTimeline(payload.period ?? "DAILY");
    case "SUCCESS_METRICS":
      return calculateSuccessMetrics();
    case "TRADE_ANALYZE":
      return Promise.all([
        scoreTradeQuality(payload.limit ?? 20),
        analyzeLateEntries(10),
        analyzeEarlyExits(10),
        analyzeLateExits(10),
      ]).then(([quality, late, early, lateExit]) => ({ quality, late, early, lateExit }));
    default:
      return { skipped: true };
  }
}

export async function runFullOptimizationCycle() {
  await runDailyPerformanceReview();
  await analyzeMissedOpportunities(15);
  await scoreTradeQuality(25);
  await rankStrategyPerformance();
  await rankCoinPerformance();
  await generateAiRecommendations();
  await updatePerformanceTimeline("DAILY");
  return calculateSuccessMetrics();
}
