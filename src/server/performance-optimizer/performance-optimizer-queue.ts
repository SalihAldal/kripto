import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { PerfOptJobType } from "@prisma/client";
import type { PerfOptJobPayload } from "@/src/server/performance-optimizer/performance-optimizer.types";
import { runPerfOptJob } from "@/src/server/performance-optimizer/performance-optimizer.orchestrator";

export const perfOptQueue = new TradingJobQueue("performance-optimizer", 2, Boolean(env.REDIS_URL));
let handlersRegistered = false;
const cache = new Map<string, { data: unknown; expiresAt: number }>();

export function getPerfOptCache(key: string) {
  const e = cache.get(key);
  return e && e.expiresAt > Date.now() ? e.data : null;
}

export function setPerfOptCache(key: string, data: unknown, ttlMs = 180_000) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

async function markJobComplete(jobType: PerfOptJobType) {
  await prisma.perfOptJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerPerfOptQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: PerfOptJobPayload["type"][] = [
    "DAILY_REVIEW", "MISSED_OPPORTUNITY", "LATE_ENTRY_ANALYZE", "EARLY_EXIT_ANALYZE",
    "LATE_EXIT_ANALYZE", "TRADE_QUALITY_SCORE", "STRATEGY_RANKING", "COIN_RANKING",
    "MARKET_CONDITION_ANALYZE", "GENERATE_RECOMMENDATIONS", "PARAMETER_RECOMMENDATIONS",
    "PAPER_LIVE_COMPARE", "TIMELINE_UPDATE", "SUCCESS_METRICS", "TRADE_ANALYZE",
  ];

  for (const type of types) {
    perfOptQueue.register<Extract<PerfOptJobPayload, { type: typeof type }>>(type, async (job) => {
      await runPerfOptJob(job.payload);
      if (job.payload.type === "DAILY_REVIEW") setPerfOptCache("daily-review", Date.now());
      await markJobComplete(type);
    });
  }
}

export async function enqueuePerfOptJob(payload: PerfOptJobPayload) {
  registerPerfOptQueueHandlers();
  return perfOptQueue.push(payload.type, payload);
}

export function startPerfOptQueue() {
  registerPerfOptQueueHandlers();
  void perfOptQueue.start();
  return perfOptQueue.stats();
}
