import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { ExitTimingJobType } from "@prisma/client";
import type { ExitTimingJobPayload } from "@/src/server/exit-timing/exit-timing.types";
import { runExitTimingJob } from "@/src/server/exit-timing/exit-timing.orchestrator";

export const exitTimingQueue = new TradingJobQueue("exit-timing", 2, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: ExitTimingJobType) {
  await prisma.exitTimingJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerExitTimingQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: ExitTimingJobPayload["type"][] = [
    "ANALYZE_EXIT", "PROFIT_PROTECTION", "EXIT_SCORE", "HOLD_REEVALUATE",
    "EXIT_QUALITY", "REPLAY_EXIT", "LEARN_EXITS", "RECOMMENDATION", "POSITION_SCAN",
  ];

  for (const type of types) {
    exitTimingQueue.register<Extract<ExitTimingJobPayload, { type: typeof type }>>(type, async (job) => {
      await runExitTimingJob(job.payload);
      await markJobComplete(type);
    });
  }
}

export async function enqueueExitTimingJob(payload: ExitTimingJobPayload) {
  registerExitTimingQueueHandlers();
  return exitTimingQueue.push(payload.type, payload);
}

export function startExitTimingQueue() {
  registerExitTimingQueueHandlers();
  void exitTimingQueue.start();
  return exitTimingQueue.stats();
}
