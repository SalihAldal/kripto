import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { EventPlatformJobPayload } from "@/src/server/event-platform/event-platform.types";
import { runEventPlatformJob } from "@/src/server/event-platform/event-platform.orchestrator";

export const eventPlatformQueue = new TradingJobQueue("event-platform", 3, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: EventPlatformJobPayload["type"]) {
  await prisma.eventPlatformJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerEventPlatformQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: EventPlatformJobPayload["type"][] = [
    "REPLAY", "RETRY", "DEAD_LETTER_PROCESS", "EVENT_CLEANUP",
    "SCHEMA_VALIDATE", "CHECKPOINT_SYNC", "OBSERVABILITY_SNAPSHOT",
  ];

  for (const type of types) {
    eventPlatformQueue.register<Extract<EventPlatformJobPayload, { type: typeof type }>>(type, async (job) => {
      await runEventPlatformJob(job.payload);
      await markJobComplete(type);
    });
  }
}

export async function enqueueEventPlatformJob(payload: EventPlatformJobPayload) {
  registerEventPlatformQueueHandlers();
  return eventPlatformQueue.push(payload.type, payload);
}

export function startEventPlatformQueue() {
  registerEventPlatformQueueHandlers();
  void eventPlatformQueue.start();
  return eventPlatformQueue.stats();
}
