import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { OnChainIntelligenceJobPayload } from "@/src/server/onchain-intelligence/onchain-intelligence.types";
import { runOnChainIntelligenceJob } from "@/src/server/onchain-intelligence/onchain-intelligence.orchestrator";

export const onChainIntelligenceQueue = new TradingJobQueue("onchain-intelligence", 3, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: OnChainIntelligenceJobPayload["type"]) {
  await prisma.onChainIntelligenceJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerOnChainIntelligenceQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: OnChainIntelligenceJobPayload["type"][] = [
    "BLOCKCHAIN_COLLECT", "ADDRESS_ANALYZE", "TX_METRICS", "EXCHANGE_RESERVE",
    "SUPPLY_TRACK", "STAKING_TRACK", "DEFI_TRACK", "BRIDGE_TRACK", "CONTRACT_TRACK",
    "DEVELOPER_TRACK", "PROTOCOL_HEALTH", "ONCHAIN_SCORE", "REPLAY_ANALYZE",
    "METRIC_LEARN", "KNOWLEDGE_BUILD",
  ];

  for (const type of types) {
    onChainIntelligenceQueue.register<Extract<OnChainIntelligenceJobPayload, { type: typeof type }>>(type, async (job) => {
      await runOnChainIntelligenceJob(job.payload);
      await markJobComplete(type);
    });
  }
}

export async function enqueueOnChainIntelligenceJob(payload: OnChainIntelligenceJobPayload) {
  registerOnChainIntelligenceQueueHandlers();
  return onChainIntelligenceQueue.push(payload.type, payload);
}

export function startOnChainIntelligenceQueue() {
  registerOnChainIntelligenceQueueHandlers();
  void onChainIntelligenceQueue.start();
  return onChainIntelligenceQueue.stats();
}
