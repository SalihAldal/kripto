import { getRuntimeExecutionContext } from "@/src/server/repositories/execution.repository";
import {
  type ApiFailureDomain,
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
  const domains: ApiFailureDomain[] = [
    "MARKET_DATA",
    "EXCHANGE_INFO",
    "SYMBOL_FILTER",
    "PRICE",
    "ORDER_BOOK",
    "BALANCE",
    "DATABASE",
    "REDIS",
    "CLOCK_SYNC",
    "AI_PROVIDER",
    "PAPER_EXECUTION",
    "LIVE_EXECUTION",
    "UNKNOWN",
  ];
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
    Promise.all(domains.map((domain) => getApiFailureStateByDomain(user.id, domain))),
  ]);

  return {
    userId: user.id,
    paused,
    openPositions,
    daily,
    weekly,
    consecutiveLosses,
    apiFailures,
    apiFailuresByDomain: Object.fromEntries(
      domains.map((domain, index) => [domain, apiFailuresByDomain[index]]),
    ),
    config,
    effective,
    gatePolicy: RISK_GATE_POLICY,
    updatedAt: new Date().toISOString(),
  };
}
