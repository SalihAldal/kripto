import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { MetaIntelligenceJobPayload } from "@/src/server/meta-intelligence/meta-intelligence.types";
import { runMetaIntelligenceJob } from "@/src/server/meta-intelligence/meta-intelligence.orchestrator";

export const metaIntelligenceQueue = new TradingJobQueue("meta-intelligence", 2, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: MetaIntelligenceJobPayload["type"]) {
  await prisma.metaIntelligenceJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerMetaIntelligenceQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: MetaIntelligenceJobPayload["type"][] = [
    "CONTEXT_BUILD", "CONTEXT_FUSION", "CONFLICT_RESOLVE", "CONFIDENCE_CALIBRATE",
    "EXECUTIVE_REASON", "NARRATIVE_BUILD", "PRIORITY_RANK", "COMMITTEE_MEET",
    "EXECUTIVE_REPORT", "EXECUTIVE_LEARN", "KNOWLEDGE_BUILD", "FUTURE_PLAN",
    "KPI_TRACK", "STRATEGIC_OBJECTIVES",
  ];

  for (const type of types) {
    metaIntelligenceQueue.register<Extract<MetaIntelligenceJobPayload, { type: typeof type }>>(type, async (job) => {
      await runMetaIntelligenceJob(job.payload);
      await markJobComplete(type);
    });
  }
}

export async function enqueueMetaIntelligenceJob(payload: MetaIntelligenceJobPayload) {
  registerMetaIntelligenceQueueHandlers();
  return metaIntelligenceQueue.push(payload.type, payload);
}

export function startMetaIntelligenceQueue() {
  registerMetaIntelligenceQueueHandlers();
  void metaIntelligenceQueue.start();
  return metaIntelligenceQueue.stats();
}
