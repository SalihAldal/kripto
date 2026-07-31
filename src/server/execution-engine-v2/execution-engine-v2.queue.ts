import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { ExecutionEngineV2JobType } from "@prisma/client";
import type { ExecutionEngineV2JobPayload } from "@/src/server/execution-engine-v2/execution-engine-v2.types";
import { runExecutionEngineV2Job } from "@/src/server/execution-engine-v2/execution-engine-v2.orchestrator";

export const executionEngineV2Queue = new TradingJobQueue("execution-engine-v2", 3, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: ExecutionEngineV2JobType) {
  await prisma.executionEngineV2JobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerExecutionEngineV2QueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: ExecutionEngineV2JobPayload["type"][] = [
    "ENTRY_EVALUATE",
    "EXIT_EVALUATE",
    "EXECUTE_ORDER",
    "VERIFY_ORDER",
    "RECONCILE",
    "RECOVERY",
    "WAIT_REEVALUATE",
    "HOLD_REEVALUATE",
  ];

  for (const type of types) {
    executionEngineV2Queue.register<Extract<ExecutionEngineV2JobPayload, { type: typeof type }>>(type, async (job) => {
      const result = await runExecutionEngineV2Job(job.payload);
      await markJobComplete(type);
      void result;
    });
  }
}

export async function enqueueExecutionEngineV2Job(payload: ExecutionEngineV2JobPayload) {
  registerExecutionEngineV2QueueHandlers();
  return executionEngineV2Queue.push(payload.type, payload);
}

export function startExecutionEngineV2Queue() {
  registerExecutionEngineV2QueueHandlers();
  void executionEngineV2Queue.start();
  return executionEngineV2Queue.stats();
}
