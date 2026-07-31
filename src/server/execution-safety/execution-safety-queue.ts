import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { ExecutionSafetyJobPayload } from "@/src/server/execution-safety/execution-safety.types";
import { getApiHealthDashboard, getSafetyDashboard, upsertExchangeHealth } from "@/src/server/execution-safety/execution-safety.repository";
import { getCircuitSnapshot } from "@/src/server/resilience/circuit-breaker";
import { emitExecutionSafetyEvent, SAFETY_EVENT } from "@/src/server/execution-safety/execution-safety.events";
import { getApiLatencyStats } from "@/src/server/execution-safety/api-health-validation.service";
import { listEmergencyActions } from "@/src/server/execution-safety/emergency-protection.service";
import { runRecoveryPipeline } from "@/src/server/execution-safety/recovery-engine.service";

export const executionSafetyQueue = new TradingJobQueue("execution-safety", 3, Boolean(env.REDIS_URL));
let handlersRegistered = false;

export function registerExecutionSafetyQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  executionSafetyQueue.register<Extract<ExecutionSafetyJobPayload, { type: "EXECUTION_VALIDATE" }>>(
    "EXECUTION_VALIDATE",
    async () => {
      await getSafetyDashboard(30);
      await prisma.executionSafetyJobState.upsert({
        where: { jobType: "EXECUTION_VALIDATE" },
        create: { jobType: "EXECUTION_VALIDATE", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  executionSafetyQueue.register<Extract<ExecutionSafetyJobPayload, { type: "EXCHANGE_HEALTH_MONITOR" }>>(
    "EXCHANGE_HEALTH_MONITOR",
    async () => {
      const circuits = getCircuitSnapshot();
      const openCount = circuits.filter((row) => row.state === "OPEN").length;
      const latency = getApiLatencyStats();
      await upsertExchangeHealth({
        healthy: openCount === 0 && latency.avgMs < 2500,
        latencyMs: latency.avgMs,
        openCircuits: openCount,
        metadata: { circuits },
      });
      if (openCount === 0 && latency.avgMs < 2500) {
        emitExecutionSafetyEvent(SAFETY_EVENT.EXCHANGE_RECOVERED, { latencyMs: latency.avgMs, openCircuits: openCount });
      }
      await prisma.executionSafetyJobState.upsert({
        where: { jobType: "EXCHANGE_HEALTH_MONITOR" },
        create: { jobType: "EXCHANGE_HEALTH_MONITOR", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  executionSafetyQueue.register<Extract<ExecutionSafetyJobPayload, { type: "API_HEALTH_CHECK" }>>(
    "API_HEALTH_CHECK",
    async () => {
      await getApiHealthDashboard();
      await prisma.executionSafetyJobState.upsert({
        where: { jobType: "API_HEALTH_CHECK" },
        create: { jobType: "API_HEALTH_CHECK", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  executionSafetyQueue.register<Extract<ExecutionSafetyJobPayload, { type: "RECOVERY_PROCESS" }>>(
    "RECOVERY_PROCESS",
    async (job) => {
      if (job.payload.executionId) {
        await runRecoveryPipeline({
          executionId: job.payload.executionId,
          failureReason: "Scheduled recovery",
        });
      }
      await prisma.executionSafetyJobState.upsert({
        where: { jobType: "RECOVERY_PROCESS" },
        create: { jobType: "RECOVERY_PROCESS", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  executionSafetyQueue.register<Extract<ExecutionSafetyJobPayload, { type: "EMERGENCY_MONITOR" }>>(
    "EMERGENCY_MONITOR",
    async () => {
      await listEmergencyActions(20);
      await prisma.executionSafetyJobState.upsert({
        where: { jobType: "EMERGENCY_MONITOR" },
        create: { jobType: "EMERGENCY_MONITOR", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  executionSafetyQueue.register<Extract<ExecutionSafetyJobPayload, { type: "DUPLICATE_DETECT" }>>(
    "DUPLICATE_DETECT",
    async () => {
      await prisma.executionSafety.findMany({ orderBy: { validatedAt: "desc" }, take: 20 });
      await prisma.executionSafetyJobState.upsert({
        where: { jobType: "DUPLICATE_DETECT" },
        create: { jobType: "DUPLICATE_DETECT", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );
}

export async function enqueueExecutionSafetyJob(payload: ExecutionSafetyJobPayload) {
  registerExecutionSafetyQueueHandlers();
  return executionSafetyQueue.push(payload.type, payload);
}

export function startExecutionSafetyQueue() {
  registerExecutionSafetyQueueHandlers();
  void executionSafetyQueue.start();
  return executionSafetyQueue.stats();
}
