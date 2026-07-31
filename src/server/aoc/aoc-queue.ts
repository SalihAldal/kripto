import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { AocJobType } from "@prisma/client";
import type { AocJobPayload } from "@/src/server/aoc/aoc.types";
import { runAocJob } from "@/src/server/aoc/aoc.orchestrator";

export const aocQueue = new TradingJobQueue("aoc", 2, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: AocJobType) {
  await prisma.aocJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerAocQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: AocJobPayload["type"][] = [
    "PLATFORM_HEALTH", "TRADING_HEALTH", "INFRASTRUCTURE_MONITOR", "EXCHANGE_MONITOR",
    "QUEUE_MONITOR", "ANOMALY_DETECT", "SELF_HEAL", "ALERT_DISPATCH", "INCIDENT_PROCESS",
    "HEALTH_SCORES", "DEPENDENCY_MAP", "KPI_MONITOR", "AI_HEALTH",
  ];

  for (const type of types) {
    aocQueue.register<Extract<AocJobPayload, { type: typeof type }>>(type, async (job) => {
      await runAocJob(job.payload);
      await markJobComplete(type);
    });
  }
}

export async function enqueueAocJob(payload: AocJobPayload) {
  registerAocQueueHandlers();
  return aocQueue.push(payload.type, payload);
}

export function startAocQueue() {
  registerAocQueueHandlers();
  void aocQueue.start();
  return aocQueue.stats();
}
