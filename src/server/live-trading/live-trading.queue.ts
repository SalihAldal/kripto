import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { LiveTradingJobPayload } from "@/src/server/live-trading/live-trading.types";
import { runLiveTradingJob } from "@/src/server/live-trading/live-trading.orchestrator";

export const liveTradingQueue = new TradingJobQueue("live-trading", 2, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: LiveTradingJobPayload["type"]) {
  await prisma.liveTradingJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerLiveTradingQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: LiveTradingJobPayload["type"][] = [
    "HEALTH_MONITOR",
    "POSITION_RECOVERY",
    "RECONCILIATION",
    "EXECUTION_AUDIT",
    "ALERT_DISPATCH",
    "CIRCUIT_BREAKER_CHECK",
    "KILL_SWITCH_MONITOR",
    "PRODUCTION_REPORT",
    "GO_LIVE_VALIDATE",
  ];

  for (const type of types) {
    liveTradingQueue.register<Extract<LiveTradingJobPayload, { type: typeof type }>>(type, async (job) => {
      await runLiveTradingJob(job.payload);
      await markJobComplete(type);
    });
  }
}

export async function enqueueLiveTradingJob(payload: LiveTradingJobPayload) {
  registerLiveTradingQueueHandlers();
  return liveTradingQueue.push(payload.type, payload);
}

export function startLiveTradingQueue() {
  registerLiveTradingQueueHandlers();
  void liveTradingQueue.start();
  return liveTradingQueue.stats();
}

export function getLiveTradingQueueStats() {
  return liveTradingQueue.stats();
}
