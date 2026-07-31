import { listActiveLiveUserIds } from "@/src/server/live-trading/live-trading.repository";
import type { LiveTradingJobPayload } from "@/src/server/live-trading/live-trading.types";
import { monitorProductionHealth } from "@/src/server/live-trading/live-health.service";
import { recoverLivePositions, recoverAllLiveUsers } from "@/src/server/live-trading/position-recovery.service";
import { reconcileUserAccount } from "@/src/server/live-trading/account-reconciliation.service";
import { auditRecentExecutions } from "@/src/server/live-trading/live-execution-audit.service";
import { dispatchPendingAlerts } from "@/src/server/live-trading/alert-dispatcher.service";
import { runCircuitBreakerChecks } from "@/src/server/live-trading/circuit-breaker.service";
import { monitorKillSwitchState } from "@/src/server/live-trading/kill-switch.service";
import { generateProductionReport, generateAllProductionReports } from "@/src/server/live-trading/production-audit.service";
import { validateGoLiveChecklist } from "@/src/server/live-trading/go-live-validator.service";

export async function runLiveTradingJob(payload: LiveTradingJobPayload) {
  switch (payload.type) {
    case "HEALTH_MONITOR":
      if (payload.userId) return monitorProductionHealth(payload.userId);
      {
        const userIds = await listActiveLiveUserIds();
        const results = [];
        for (const userId of userIds) {
          results.push(await monitorProductionHealth(userId));
        }
        if (results.length === 0) return monitorProductionHealth();
        return { users: results.length, results };
      }
    case "POSITION_RECOVERY":
      if (payload.userId) return recoverLivePositions(payload.userId);
      return recoverAllLiveUsers();
    case "RECONCILIATION":
      if (payload.userId) return reconcileUserAccount(payload.userId);
      {
        const userIds = await listActiveLiveUserIds();
        const results = [];
        for (const userId of userIds) {
          results.push(await reconcileUserAccount(userId));
        }
        return { users: results.length, results };
      }
    case "EXECUTION_AUDIT":
      return auditRecentExecutions(payload.userId, payload.limit ?? 50);
    case "ALERT_DISPATCH":
      return dispatchPendingAlerts(payload.limit ?? 50);
    case "CIRCUIT_BREAKER_CHECK":
      return runCircuitBreakerChecks(payload.userId);
    case "KILL_SWITCH_MONITOR":
      return monitorKillSwitchState();
    case "PRODUCTION_REPORT":
      if (payload.userId) {
        return generateProductionReport({
          userId: payload.userId,
          cadence: payload.cadence ?? "DAILY",
        });
      }
      return generateAllProductionReports(payload.cadence ?? "DAILY");
    case "GO_LIVE_VALIDATE":
      if (payload.userId) return validateGoLiveChecklist(payload.userId);
      {
        const userIds = await listActiveLiveUserIds();
        const results = [];
        for (const userId of userIds) {
          results.push(await validateGoLiveChecklist(userId));
        }
        return { users: results.length, results };
      }
    default:
      return { skipped: true };
  }
}
