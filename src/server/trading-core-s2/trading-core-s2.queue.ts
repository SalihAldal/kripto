import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { TradingCoreS2JobType } from "@prisma/client";
import type { TradingCoreS2JobPayload } from "@/src/server/trading-core-s2/trading-core-s2.types";
import { runTradingCoreS2Job } from "@/src/server/trading-core-s2/trading-core-s2.orchestrator";

export const tradingCoreS2Queue = new TradingJobQueue("trading-core-s2", 3, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: TradingCoreS2JobType) {
  await prisma.tradingCoreS2JobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerTradingCoreS2QueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: TradingCoreS2JobPayload["type"][] = [
    "REGIME_REFRESH",
    "DISCOVERY_SCAN",
    "DISCOVERY_RANKING",
    "MOMENTUM_EVALUATE",
    "STATISTICS_UPDATE",
  ];

  for (const type of types) {
    tradingCoreS2Queue.register<Extract<TradingCoreS2JobPayload, { type: typeof type }>>(type, async (job) => {
      const result = await runTradingCoreS2Job(job.payload);
      await markJobComplete(type);
      void result;
    });
  }
}

export async function enqueueTradingCoreS2Job(payload: TradingCoreS2JobPayload) {
  registerTradingCoreS2QueueHandlers();
  return tradingCoreS2Queue.push(payload.type, payload);
}

export function startTradingCoreS2Queue() {
  registerTradingCoreS2QueueHandlers();
  void tradingCoreS2Queue.start();
  return tradingCoreS2Queue.stats();
}
