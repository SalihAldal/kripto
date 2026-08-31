import { getRuntimeExecutionContext } from "@/src/server/repositories/execution.repository";
import {
  getApiFailureState,
  getApiFailureStateByDomain,
  getConsecutiveLossCount,
  getDailyPnlSummary,
  getWeeklyPnlSummary,
  getPausedState,
  getRiskConfigByUser,
  listOpenPositionsCount,
} from "@/src/server/repositories/risk.repository";
import { getEffectiveRiskConfig, RISK_GATE_POLICY } from "@/src/server/risk/risk-evaluation.service";

export async function getRiskStatus(userId?: string) {
  const { user } = await getRuntimeExecutionContext(userId);
  const [config, effective, paused, daily, weekly, openPositions, consecutiveLosses, apiFailures, apiFailuresByDomain] = await Promise.all([
    getRiskConfigByUser(user.id),
    getEffectiveRiskConfig(user.id),
    getPausedState(user.id),
    getDailyPnlSummary(user.id),
    getWeeklyPnlSummary(user.id),
    listOpenPositionsCount(user.id),
    getConsecutiveLossCount(user.id),
    getApiFailureState(user.id),
    Promise.all([
      getApiFailureStateByDomain(user.id, "EXECUTION"),
      getApiFailureStateByDomain(user.id, "ACCOUNT"),
      getApiFailureStateByDomain(user.id, "MARKET_DATA"),
      getApiFailureStateByDomain(user.id, "METADATA"),
    ]),
  ]);

  return {
    userId: user.id,
    paused,
    openPositions,
    daily,
    weekly,
    consecutiveLosses,
    apiFailures,
    apiFailuresByDomain: {
      EXECUTION: apiFailuresByDomain[0],
      ACCOUNT: apiFailuresByDomain[1],
      MARKET_DATA: apiFailuresByDomain[2],
      METADATA: apiFailuresByDomain[3],
    },
    config,
    effective,
    gatePolicy: RISK_GATE_POLICY,
    updatedAt: new Date().toISOString(),
  };
}
