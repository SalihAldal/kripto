import { collectPlatformHealth } from "@/src/server/aoc/platform-health.service";
import { collectTradingHealth } from "@/src/server/aoc/trading-health.service";
import { collectBusinessKpis } from "@/src/server/aoc/business-kpi.service";
import { collectAiHealth } from "@/src/server/aoc/ai-health.service";
import { monitorInfrastructure } from "@/src/server/aoc/infrastructure-monitor.service";
import { monitorExchange } from "@/src/server/aoc/exchange-monitor.service";
import { monitorQueues } from "@/src/server/aoc/queue-monitor.service";
import { detectAnomalies } from "@/src/server/aoc/anomaly-detection.service";
import { runSelfHealing } from "@/src/server/aoc/self-healing.service";
import { processPendingAlerts } from "@/src/server/aoc/alert-engine.service";
import { processOpenIncidents } from "@/src/server/aoc/incident-management.service";
import { calculateHealthScores } from "@/src/server/aoc/health-scores.service";
import { buildDependencyMap } from "@/src/server/aoc/dependency-map.service";
import { generateOperationalTimeline } from "@/src/server/aoc/operational-timeline.service";
import type { AocJobPayload } from "@/src/server/aoc/aoc.types";

export async function runAocJob(payload: AocJobPayload) {
  switch (payload.type) {
    case "PLATFORM_HEALTH":
      return collectPlatformHealth();
    case "TRADING_HEALTH":
      return collectTradingHealth();
    case "INFRASTRUCTURE_MONITOR":
      return monitorInfrastructure();
    case "EXCHANGE_MONITOR":
      return monitorExchange();
    case "QUEUE_MONITOR":
      return monitorQueues();
    case "ANOMALY_DETECT":
      return detectAnomalies();
    case "SELF_HEAL":
      return runSelfHealing();
    case "ALERT_DISPATCH":
      return processPendingAlerts();
    case "INCIDENT_PROCESS":
      return processOpenIncidents();
    case "HEALTH_SCORES":
      return calculateHealthScores();
    case "DEPENDENCY_MAP":
      return buildDependencyMap();
    case "KPI_MONITOR":
      return collectBusinessKpis();
    case "AI_HEALTH":
      return collectAiHealth();
    default:
      return { skipped: true };
  }
}

export async function runAocFullCycle() {
  await collectPlatformHealth();
  await collectTradingHealth();
  await monitorInfrastructure();
  await monitorExchange();
  await monitorQueues();
  await collectBusinessKpis();
  await collectAiHealth();
  await detectAnomalies();
  await calculateHealthScores();
  await processOpenIncidents();
  await processPendingAlerts();
  return generateOperationalTimeline("CYCLE");
}
