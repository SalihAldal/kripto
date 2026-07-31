import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { EntryTimingJobType } from "@prisma/client";
import type { EntryTimingJobPayload } from "@/src/server/entry-timing/entry-timing.types";
import { runEntryTimingJob } from "@/src/server/entry-timing/entry-timing.orchestrator";

export const entryTimingQueue = new TradingJobQueue("entry-timing", 2, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: EntryTimingJobType) {
  await prisma.entryTimingJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerEntryTimingQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: EntryTimingJobPayload["type"][] = [
    "ANALYZE_ENTRY", "CONFIRM_ENTRY", "FILTER_CHECK", "WAIT_REEVALUATE",
    "QUALITY_SCORE", "REPLAY_ENTRY", "LEARN_PATTERNS", "HEATMAP_BUILD", "RECOMMENDATION",
  ];

  for (const type of types) {
    entryTimingQueue.register<Extract<EntryTimingJobPayload, { type: typeof type }>>(type, async (job) => {
      await runEntryTimingJob(job.payload);
      await markJobComplete(type);
    });
  }
}

export async function enqueueEntryTimingJob(payload: EntryTimingJobPayload) {
  registerEntryTimingQueueHandlers();
  return entryTimingQueue.push(payload.type, payload);
}

export function startEntryTimingQueue() {
  registerEntryTimingQueueHandlers();
  void entryTimingQueue.start();
  return entryTimingQueue.stats();
}
