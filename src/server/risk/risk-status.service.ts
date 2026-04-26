import { getRuntimeExecutionContext } from "@/src/server/repositories/execution.repository";
import {
  getApiFailureState,
  getConsecutiveLossCount,
  getDailyPnlSummary,
  getWeeklyPnlSummary,
  getPausedState,
  getRiskConfigByUser,
  listOpenPositionsCount,
} from "@/src/server/repositories/risk.repository";
import { getEffectiveRiskConfig } from "@/src/server/risk/risk-evaluation.service";

export async function getRiskStatus(userId?: string) {
  const { user } = await getRuntimeExecutionContext(userId);
  const [config, effective, paused, daily, weekly, openPositions, consecutiveLosses, apiFailures] = await Promise.all([
    getRiskConfigByUser(user.id),
    getEffectiveRiskConfig(user.id),
    getPausedState(user.id),
    getDailyPnlSummary(user.id),
    getWeeklyPnlSummary(user.id),
    listOpenPositionsCount(user.id),
    getConsecutiveLossCount(user.id),
    getApiFailureState(user.id),
  ]);

  return {
    userId: user.id,
    paused,
    openPositions,
    daily,
    weekly,
    consecutiveLosses,
    apiFailures,
    config,
    effective,
    updatedAt: new Date().toISOString(),
  };
}
