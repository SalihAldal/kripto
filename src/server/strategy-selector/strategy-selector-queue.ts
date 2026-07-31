import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { StrategySelectorJobType } from "@prisma/client";
import type { StrategySelectorJobPayload } from "@/src/server/strategy-selector/strategy-selector.types";
import { runStrategySelectorJob } from "@/src/server/strategy-selector/strategy-selector.orchestrator";

export const strategySelectorQueue = new TradingJobQueue("strategy-selector", 2, Boolean(env.REDIS_URL));
let handlersRegistered = false;

const cache = new Map<string, { result: unknown; expiresAt: number }>();

export function getCachedSelection(symbol: string) {
  const entry = cache.get(`sel:${symbol.toUpperCase()}`);
  if (entry && entry.expiresAt > Date.now()) return entry.result;
  return null;
}

export function setCachedSelection(symbol: string, result: unknown, ttlMs = 120_000) {
  cache.set(`sel:${symbol.toUpperCase()}`, { result, expiresAt: Date.now() + ttlMs });
}

async function markJobComplete(jobType: StrategySelectorJobType) {
  await prisma.strategySelectorJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerStrategySelectorQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: StrategySelectorJobPayload["type"][] = [
    "DETECT_REGIME", "CLASSIFY_COIN", "SCORE_STRATEGIES", "SELECT_STRATEGY",
    "VALIDATE_SELECTION", "REPLAY_STRATEGY", "BENCHMARK_STRATEGIES", "LEARN_STRATEGIES",
    "SWITCH_CHECK", "UPDATE_KNOWLEDGE", "PERFORMANCE_SYNC",
  ];

  for (const type of types) {
    strategySelectorQueue.register<Extract<StrategySelectorJobPayload, { type: typeof type }>>(type, async (job) => {
      const result = await runStrategySelectorJob(job.payload);
      if (job.payload.type === "SELECT_STRATEGY" && "symbol" in job.payload) {
        setCachedSelection(job.payload.symbol, result);
      }
      await markJobComplete(type);
    });
  }
}

export async function enqueueStrategySelectorJob(payload: StrategySelectorJobPayload) {
  registerStrategySelectorQueueHandlers();
  return strategySelectorQueue.push(payload.type, payload);
}

export function startStrategySelectorQueue() {
  registerStrategySelectorQueueHandlers();
  void strategySelectorQueue.start();
  return strategySelectorQueue.stats();
}
