import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { EngineeringIntelligenceJobPayload } from "@/src/server/engineering-intelligence/engineering-intelligence.types";
import { runEngineeringIntelligenceJob } from "@/src/server/engineering-intelligence/engineering-intelligence.orchestrator";

export const engineeringIntelligenceQueue = new TradingJobQueue("engineering-intelligence", 2, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: EngineeringIntelligenceJobPayload["type"]) {
  await prisma.engineeringIntelligenceJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerEngineeringIntelligenceQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: EngineeringIntelligenceJobPayload["type"][] = [
    "DAILY_AUDIT", "WEEKLY_AUDIT", "ARCHITECTURE_SCAN", "CODE_QUALITY_SCAN",
    "PERFORMANCE_SCAN", "SECURITY_SCAN", "DATABASE_SCAN", "QUEUE_SCAN",
    "API_SCAN", "INFRASTRUCTURE_SCAN", "DEPENDENCY_SCAN", "DOCUMENTATION_SCAN",
    "TEST_SCAN", "OBSERVABILITY_SCAN", "BUSINESS_RULE_SCAN", "AI_USAGE_SCAN",
    "TRADING_PLATFORM_SCAN", "HEALTH_SCORE", "REFACTORING_ADVISE",
  ];

  for (const type of types) {
    engineeringIntelligenceQueue.register<Extract<EngineeringIntelligenceJobPayload, { type: typeof type }>>(type, async (job) => {
      await runEngineeringIntelligenceJob(job.payload);
      await markJobComplete(type);
    });
  }
}

export async function enqueueEngineeringIntelligenceJob(payload: EngineeringIntelligenceJobPayload) {
  registerEngineeringIntelligenceQueueHandlers();
  return engineeringIntelligenceQueue.push(payload.type, payload);
}

export function startEngineeringIntelligenceQueue() {
  registerEngineeringIntelligenceQueueHandlers();
  void engineeringIntelligenceQueue.start();
  return engineeringIntelligenceQueue.stats();
}
