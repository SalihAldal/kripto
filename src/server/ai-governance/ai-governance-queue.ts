import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { AiGovernanceJobPayload } from "@/src/server/ai-governance/ai-governance.types";
import { runAiGovernanceJob } from "@/src/server/ai-governance/ai-governance.orchestrator";

export const aiGovernanceQueue = new TradingJobQueue("ai-governance", 2, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: AiGovernanceJobPayload["type"]) {
  await prisma.aiGovernanceJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerAiGovernanceQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: AiGovernanceJobPayload["type"][] = [
    "DEPLOYMENT_PROCESS",
    "ROLLBACK_CHECK",
    "APPROVAL_PROCESS",
    "HEALTH_MONITOR",
    "GOVERNANCE_MONITOR",
    "AUDIT_SYNC",
    "CANARY_EVALUATE",
    "SHADOW_EVALUATE",
    "FEATURE_FLAG_SYNC",
    "CONFIG_VALIDATE",
    "PROMOTION_EVALUATE",
  ];

  for (const type of types) {
    aiGovernanceQueue.register<Extract<AiGovernanceJobPayload, { type: typeof type }>>(type, async (job) => {
      await runAiGovernanceJob(job.payload);
      await markJobComplete(type);
    });
  }
}

export async function enqueueAiGovernanceJob(payload: AiGovernanceJobPayload) {
  registerAiGovernanceQueueHandlers();
  return aiGovernanceQueue.push(payload.type, payload);
}

export function startAiGovernanceQueue() {
  registerAiGovernanceQueueHandlers();
  void aiGovernanceQueue.start();
  return aiGovernanceQueue.stats();
}
