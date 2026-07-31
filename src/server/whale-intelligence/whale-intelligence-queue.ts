import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { WhaleIntelligenceJobPayload } from "@/src/server/whale-intelligence/whale-intelligence.types";
import { runWhaleIntelligenceJob } from "@/src/server/whale-intelligence/whale-intelligence.orchestrator";

export const whaleIntelligenceQueue = new TradingJobQueue("whale-intelligence", 3, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: WhaleIntelligenceJobPayload["type"]) {
  await prisma.whaleIntelligenceJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerWhaleIntelligenceQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: WhaleIntelligenceJobPayload["type"][] = [
    "WHALE_DETECT",
    "WALLET_MONITOR",
    "EXCHANGE_FLOW",
    "STABLECOIN_FLOW",
    "FLOW_CALCULATE",
    "WHALE_SCORE",
    "LIQUIDITY_ROTATION",
    "PATTERN_DETECT",
    "REPLAY_ANALYZE",
    "INSTITUTIONAL_LEARN",
    "ALERT_GENERATE",
  ];

  for (const type of types) {
    whaleIntelligenceQueue.register<Extract<WhaleIntelligenceJobPayload, { type: typeof type }>>(type, async (job) => {
      await runWhaleIntelligenceJob(job.payload);
      await markJobComplete(type);
    });
  }
}

export async function enqueueWhaleIntelligenceJob(payload: WhaleIntelligenceJobPayload) {
  registerWhaleIntelligenceQueueHandlers();
  return whaleIntelligenceQueue.push(payload.type, payload);
}

export function startWhaleIntelligenceQueue() {
  registerWhaleIntelligenceQueueHandlers();
  void whaleIntelligenceQueue.start();
  return whaleIntelligenceQueue.stats();
}
