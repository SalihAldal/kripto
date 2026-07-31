import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { LearningPlatformJobPayload } from "@/src/server/learning-platform/learning-platform.types";
import { runLearningPlatformJob } from "@/src/server/learning-platform/learning-platform.orchestrator";

export const learningPlatformQueue = new TradingJobQueue("learning-platform", 2, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: LearningPlatformJobPayload["type"]) {
  await prisma.learningPlatformJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerLearningPlatformQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: LearningPlatformJobPayload["type"][] = [
    "DATASET_BUILD",
    "DATASET_VALIDATE",
    "TRAIN_MODEL",
    "EVALUATE_MODEL",
    "REGISTRY_SYNC",
    "COIN_LEARN",
    "MARKET_MEMORY",
    "TRADE_MEMORY",
    "MISSED_OPPORTUNITY",
    "DAILY_REPORT",
    "PROMOTION_CANDIDATE",
  ];

  for (const type of types) {
    learningPlatformQueue.register<Extract<LearningPlatformJobPayload, { type: typeof type }>>(type, async (job) => {
      const result = await runLearningPlatformJob(job.payload);
      await markJobComplete(type);
      void result;
    });
  }
}

export async function enqueueLearningPlatformJob(payload: LearningPlatformJobPayload) {
  registerLearningPlatformQueueHandlers();
  return learningPlatformQueue.push(payload.type, payload);
}

export function startLearningPlatformQueue() {
  registerLearningPlatformQueueHandlers();
  void learningPlatformQueue.start();
  return learningPlatformQueue.stats();
}
