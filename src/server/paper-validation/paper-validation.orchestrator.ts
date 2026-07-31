import { listActivePaperUserIds } from "@/src/server/paper-validation/paper-validation.repository";
import type { PaperValidationJobPayload } from "@/src/server/paper-validation/paper-validation.types";
import { syncAllPaperPortfolios, syncPaperPortfolio } from "@/src/server/paper-validation/paper-portfolio.service";
import { recordPaperTradesFromPositions } from "@/src/server/paper-validation/paper-trade-recorder.service";
import { calculatePaperAccuracy, calculatePaperMetrics } from "@/src/server/paper-validation/paper-accuracy.service";
import { updateCoinScoreboard } from "@/src/server/paper-validation/coin-scoreboard.service";
import { analyzeSessionPerformance } from "@/src/server/paper-validation/session-analysis.service";
import { analyzeMissedOpportunities } from "@/src/server/paper-validation/missed-opportunity.service";
import { validatePaperRisk } from "@/src/server/paper-validation/risk-validation.service";
import { calculateAllReadinessScores, calculateLiveReadiness } from "@/src/server/paper-validation/live-readiness.service";
import { generateDailyPaperReport } from "@/src/server/paper-validation/daily-paper-report.service";

export async function runPaperValidationJob(payload: PaperValidationJobPayload) {
  switch (payload.type) {
    case "SYNC_PORTFOLIO":
      if (payload.userId) return syncPaperPortfolio(payload.userId);
      return syncAllPaperPortfolios();
    case "RECORD_TRADES": {
      const userIds = payload.userId ? [payload.userId] : await listActivePaperUserIds();
      let recorded = 0;
      for (const userId of userIds) {
        const result = await recordPaperTradesFromPositions({ userId, limit: payload.limit });
        recorded += result.recorded;
      }
      return { recorded, users: userIds.length };
    }
    case "CALCULATE_METRICS": {
      const userIds = payload.userId ? [payload.userId] : await listActivePaperUserIds();
      const results = [];
      for (const userId of userIds) {
        results.push(await calculatePaperMetrics(userId));
      }
      return { users: results.length, results };
    }
    case "COIN_RANKING":
      return updateCoinScoreboard(payload.userId);
    case "SESSION_ANALYSIS":
      return analyzeSessionPerformance(payload.userId);
    case "MISSED_OPPORTUNITY":
      return analyzeMissedOpportunities({ userId: payload.userId, limit: payload.limit });
    case "ACCURACY_CHECK":
      return calculatePaperAccuracy({ userId: payload.userId, limit: payload.limit });
    case "RISK_VALIDATION":
      if (payload.userId) return validatePaperRisk(payload.userId);
      {
        const userIds = await listActivePaperUserIds();
        const results = [];
        for (const userId of userIds) {
          results.push(await validatePaperRisk(userId));
        }
        return { users: results.length, results };
      }
    case "READINESS_SCORE":
      if (payload.userId) return calculateLiveReadiness(payload.userId);
      return calculateAllReadinessScores();
    case "DAILY_REPORT":
      return generateDailyPaperReport({
        userId: payload.userId,
        date: payload.date ? new Date(payload.date) : new Date(),
      });
    default:
      return { skipped: true };
  }
}
