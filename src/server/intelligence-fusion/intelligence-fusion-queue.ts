import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { IntelligenceFusionJobPayload } from "@/src/server/intelligence-fusion/intelligence-fusion.types";
import { runIntelligenceFusionJob } from "@/src/server/intelligence-fusion/intelligence-fusion.orchestrator";

export const intelligenceFusionQueue = new TradingJobQueue("intelligence-fusion", 2, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: IntelligenceFusionJobPayload["type"]) {
  await prisma.intelligenceFusionJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerIntelligenceFusionQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: IntelligenceFusionJobPayload["type"][] = [
    "FUSION_PIPELINE", "CONFLICT_RESOLVE", "SOURCE_RELIABILITY", "NARRATIVE_BUILD",
    "EVIDENCE_COLLECT", "FUSION_REPLAY", "QUALITY_SCORE", "KNOWLEDGE_INTEGRATE", "VALIDATE_PUBLISH",
  ];

  for (const type of types) {
    intelligenceFusionQueue.register<Extract<IntelligenceFusionJobPayload, { type: typeof type }>>(type, async (job) => {
      await runIntelligenceFusionJob(job.payload);
      await markJobComplete(type);
    });
  }
}

export async function enqueueIntelligenceFusionJob(payload: IntelligenceFusionJobPayload) {
  registerIntelligenceFusionQueueHandlers();
  return intelligenceFusionQueue.push(payload.type, payload);
}

export function startIntelligenceFusionQueue() {
  registerIntelligenceFusionQueueHandlers();
  void intelligenceFusionQueue.start();
  return intelligenceFusionQueue.stats();
}
