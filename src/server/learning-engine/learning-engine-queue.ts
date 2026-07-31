import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { LearningEngineJobPayload } from "@/src/server/learning-engine/learning-engine.types";
import { runLearningEngineJob } from "@/src/server/learning-engine/learning-engine.orchestrator";

export const learningEngineQueue = new TradingJobQueue("learning-engine", 2, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: LearningEngineJobPayload["type"]) {
  await prisma.learningEngineJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerLearningEngineQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const register = <T extends LearningEngineJobPayload["type"]>(type: T) => {
    learningEngineQueue.register<Extract<LearningEngineJobPayload, { type: T }>>(type, async (job) => {
      await runLearningEngineJob(job.payload);
      await markJobComplete(type);
    });
  };

  register("DECISION_LEARN");
  register("TRADE_LEARN");
  register("REJECT_LEARN");
  register("MISSED_OPPORTUNITY_LEARN");
  register("FALSE_POSITIVE_LEARN");
  register("PATTERN_DISCOVERY");
  register("FEATURE_IMPORTANCE");
  register("WEIGHT_RECOMMENDATION");
  register("DAILY_AI_REPORT");
  register("WEEKLY_RESEARCH");
  register("KNOWLEDGE_BUILD");
  register("CONFIDENCE_CALIBRATION");
  register("RESEARCH_LAB");
  register("MEMORY_SYNC");
}

export async function enqueueLearningEngineJob(payload: LearningEngineJobPayload) {
  registerLearningEngineQueueHandlers();
  return learningEngineQueue.push(payload.type, payload);
}

export function startLearningEngineQueue() {
  registerLearningEngineQueueHandlers();
  void learningEngineQueue.start();
  return learningEngineQueue.stats();
}

export function scheduleDecisionLearning(decisionId: string) {
  void enqueueLearningEngineJob({ type: "DECISION_LEARN", decisionId }).catch((error) =>
    logger.warn({ decisionId, error: (error as Error).message }, "Decision learning enqueue failed"),
  );
}
