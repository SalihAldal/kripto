import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { DecisionEngineV2JobType } from "@prisma/client";
import type { DecisionEngineV2JobPayload } from "@/src/server/decision-engine-v2/decision-engine-v2.types";
import { runDecisionEngineV2Job } from "@/src/server/decision-engine-v2/decision-engine-v2.orchestrator";

export const decisionEngineV2Queue = new TradingJobQueue("decision-engine-v2", 3, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: DecisionEngineV2JobType) {
  await prisma.decisionEngineV2JobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerDecisionEngineV2QueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: DecisionEngineV2JobPayload["type"][] = [
    "PREDICTION_BATCH",
    "MODEL_TRAIN",
    "MODEL_VALIDATE",
    "CALIBRATION_UPDATE",
    "FEATURE_IMPORTANCE",
    "SHADOW_PERFORMANCE",
    "PROMOTION_CHECK",
    "REGISTRY_SYNC",
  ];

  for (const type of types) {
    decisionEngineV2Queue.register<Extract<DecisionEngineV2JobPayload, { type: typeof type }>>(type, async (job) => {
      const result = await runDecisionEngineV2Job(job.payload);
      await markJobComplete(type);
      void result;
    });
  }
}

export async function enqueueDecisionEngineV2Job(payload: DecisionEngineV2JobPayload) {
  registerDecisionEngineV2QueueHandlers();
  return decisionEngineV2Queue.push(payload.type, payload);
}

export function startDecisionEngineV2Queue() {
  registerDecisionEngineV2QueueHandlers();
  void decisionEngineV2Queue.start();
  return decisionEngineV2Queue.stats();
}
