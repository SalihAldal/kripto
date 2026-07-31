import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { PaperValidationJobPayload } from "@/src/server/paper-validation/paper-validation.types";
import { runPaperValidationJob } from "@/src/server/paper-validation/paper-validation.orchestrator";

export const paperValidationQueue = new TradingJobQueue("paper-validation", 2, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: PaperValidationJobPayload["type"]) {
  await prisma.paperValidationJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerPaperValidationQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: PaperValidationJobPayload["type"][] = [
    "SYNC_PORTFOLIO",
    "RECORD_TRADES",
    "CALCULATE_METRICS",
    "COIN_RANKING",
    "SESSION_ANALYSIS",
    "MISSED_OPPORTUNITY",
    "ACCURACY_CHECK",
    "RISK_VALIDATION",
    "READINESS_SCORE",
    "DAILY_REPORT",
  ];

  for (const type of types) {
    paperValidationQueue.register<Extract<PaperValidationJobPayload, { type: typeof type }>>(type, async (job) => {
      await runPaperValidationJob(job.payload);
      await markJobComplete(type);
    });
  }
}

export async function enqueuePaperValidationJob(payload: PaperValidationJobPayload) {
  registerPaperValidationQueueHandlers();
  return paperValidationQueue.push(payload.type, payload);
}

export function startPaperValidationQueue() {
  registerPaperValidationQueueHandlers();
  void paperValidationQueue.start();
  return paperValidationQueue.stats();
}

export function getPaperValidationQueueStats() {
  return paperValidationQueue.stats();
}
