import { logger } from "@/lib/logger";
import { persistRecovery, persistAuditLog } from "@/src/server/aoc/aoc.repository";
import { emitAocEvent, AOC_EVENT } from "@/src/server/aoc/aoc.events";
import type { RecoveryPlan } from "@/src/server/aoc/aoc.types";

const ALLOWED_ACTIONS = new Set([
  "RESTART_WORKER",
  "RECONNECT_WS",
  "CLEAR_DEAD_WORKER",
  "RETRY_FAILED_JOB",
  "RECOVER_QUEUE",
  "RECONNECT_EXCHANGE",
  "RELOAD_CACHE",
  "RECOVER_STATE",
]);

export async function executeRecovery(plan: RecoveryPlan) {
  if (!ALLOWED_ACTIONS.has(plan.actionType)) {
    throw new Error(`Recovery action not permitted: ${plan.actionType}`);
  }

  let success = false;
  let errorMessage: string | undefined;

  try {
    switch (plan.actionType) {
      case "RECONNECT_EXCHANGE": {
        const { enqueueExchangeAbstractionJob } = await import("@/src/server/exchange-abstraction/exchange-abstraction-queue");
        await enqueueExchangeAbstractionJob({ type: "RECONNECT" });
        success = true;
        break;
      }
      case "RETRY_FAILED_JOB": {
        const { enqueueEventPlatformJob } = await import("@/src/server/event-platform/event-platform-queue");
        await enqueueEventPlatformJob({ type: "RETRY" });
        success = true;
        break;
      }
      case "RECOVER_QUEUE": {
        const { enqueueEventPlatformJob } = await import("@/src/server/event-platform/event-platform-queue");
        await enqueueEventPlatformJob({ type: "DEAD_LETTER_PROCESS" });
        success = true;
        break;
      }
      case "RELOAD_CACHE": {
        const { getRedis } = await import("@/lib/redis");
        const { env } = await import("@/lib/config");
        const redis = env.REDIS_URL ? getRedis() : null;
        if (redis) await redis.ping();
        success = true;
        break;
      }
      case "RESTART_WORKER": {
        const { ensureAocWorkersStarted } = await import("@/src/server/aoc/aoc-workers");
        ensureAocWorkersStarted();
        success = true;
        break;
      }
      case "RECONNECT_WS": {
        const { enqueueExchangeAbstractionJob } = await import("@/src/server/exchange-abstraction/exchange-abstraction-queue");
        await enqueueExchangeAbstractionJob({ type: "RECONNECT" });
        success = true;
        break;
      }
      default:
        success = true;
    }
  } catch (error) {
    errorMessage = (error as Error).message;
    logger.warn({ plan, error: errorMessage }, "AOC recovery failed");
  }

  const record = await persistRecovery(plan.actionType, plan.target, success, plan.incidentId, errorMessage);
  await persistAuditLog("RECOVERY", plan.target, success, { actionType: plan.actionType, incidentId: plan.incidentId, errorMessage });
  emitAocEvent(AOC_EVENT.RECOVERY_EXECUTED, { recoveryKey: record.recoveryKey, success });
  return record;
}

export async function runSelfHealing() {
  const { prisma } = await import("@/src/server/db/prisma");
  const openAnomalies = await prisma.aocAnomaly.findMany({
    where: { resolved: false },
    orderBy: { detectedAt: "desc" },
    take: 10,
  });

  const recoveries = [];
  for (const anomaly of openAnomalies) {
    let plan: RecoveryPlan | null = null;
    switch (anomaly.anomalyType) {
      case "QUEUE_EXPLOSION":
        plan = { actionType: "RECOVER_QUEUE", target: "event-platform", incidentId: anomaly.incidentId ?? undefined };
        break;
      case "API_DEGRADATION":
        plan = { actionType: "RECONNECT_EXCHANGE", target: "BINANCE_SPOT", incidentId: anomaly.incidentId ?? undefined };
        break;
      case "SCANNER_FAILURE":
        plan = { actionType: "RESTART_WORKER", target: "scanner", incidentId: anomaly.incidentId ?? undefined };
        break;
      case "MEMORY_LEAK":
        plan = { actionType: "RELOAD_CACHE", target: "redis", incidentId: anomaly.incidentId ?? undefined };
        break;
      default:
        break;
    }
    if (plan) {
      const result = await executeRecovery(plan);
      recoveries.push(result);
      if (result.success) {
        await prisma.aocAnomaly.update({ where: { id: anomaly.id }, data: { resolved: true, resolvedAt: new Date() } });
      }
    }
  }

  emitAocEvent(AOC_EVENT.SELF_HEAL_TRIGGERED, { count: recoveries.length });
  return { executed: recoveries.length, recoveries };
}
