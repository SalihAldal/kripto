import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { ExecutionMgmtJobPayload } from "@/src/server/execution-management/execution-management.types";
import { replayRecentExecutions } from "@/src/server/execution-management/execution-replay.service";
import {
  aggregateExecutionStatistics,
  capturePortfolioSnapshot,
  runPositionSync,
} from "@/src/server/execution-management/execution-statistics.service";
import { subscribeExecutionEvents } from "@/src/server/execution/execution-event-bus";
import { replayExecutionRecord } from "@/src/server/execution-management/execution-replay.service";

export const executionMgmtQueue = new TradingJobQueue("execution-management", 3, Boolean(env.REDIS_URL));
let handlersRegistered = false;
let busHookRegistered = false;

function registerExecutionBusHook() {
  if (busHookRegistered) return;
  busHookRegistered = true;
  subscribeExecutionEvents((event) => {
    if (event.stage !== "validation" || event.status !== "SUCCESS") return;
    const ctx = event.context ?? {};
    void enqueueExecutionMgmtJob({
      type: "EXECUTION_REPLAY",
      executionId: event.executionId,
    }).catch(() => null);
    if (typeof ctx.requestedQty === "number" && typeof ctx.executedQty === "number") {
      void replayExecutionRecord({
        executionId: event.executionId,
        symbol: event.symbol ?? "UNKNOWN",
        side: String(ctx.side ?? "BUY"),
        mode: String(ctx.mode ?? "live"),
        requestedQty: Number(ctx.requestedQty),
        executedQty: Number(ctx.executedQty),
        requestedPrice: Number(ctx.requestedPrice ?? ctx.entryPrice ?? 0),
        executionPrice: Number(ctx.executionPrice ?? ctx.entryPrice ?? 0),
        fees: Number(ctx.fees ?? 0),
      }).catch(() => null);
    }
  });
}

export function registerExecutionMgmtQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;
  registerExecutionBusHook();

  executionMgmtQueue.register<Extract<ExecutionMgmtJobPayload, { type: "EXECUTION_VALIDATE" }>>(
    "EXECUTION_VALIDATE",
    async () => {
      await prisma.executionMgmtJobState.upsert({
        where: { jobType: "EXECUTION_VALIDATE" },
        create: { jobType: "EXECUTION_VALIDATE", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  executionMgmtQueue.register<Extract<ExecutionMgmtJobPayload, { type: "POSITION_SYNC" }>>(
    "POSITION_SYNC",
    async (job) => {
      const users = job.payload.userId
        ? [{ id: job.payload.userId }]
        : await prisma.user.findMany({ select: { id: true }, take: 20 });
      for (const user of users) await runPositionSync(user.id);
      await prisma.executionMgmtJobState.upsert({
        where: { jobType: "POSITION_SYNC" },
        create: { jobType: "POSITION_SYNC", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  executionMgmtQueue.register<Extract<ExecutionMgmtJobPayload, { type: "PORTFOLIO_SNAPSHOT" }>>(
    "PORTFOLIO_SNAPSHOT",
    async (job) => {
      const users = job.payload.userId
        ? [{ id: job.payload.userId }]
        : await prisma.user.findMany({ select: { id: true }, take: 20 });
      for (const user of users) {
        await capturePortfolioSnapshot(user.id, (job.payload.mode as "live" | "paper") ?? "live");
      }
      await prisma.executionMgmtJobState.upsert({
        where: { jobType: "PORTFOLIO_SNAPSHOT" },
        create: { jobType: "PORTFOLIO_SNAPSHOT", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  executionMgmtQueue.register<Extract<ExecutionMgmtJobPayload, { type: "EXECUTION_REPLAY" }>>(
    "EXECUTION_REPLAY",
    async (job) => {
      if (job.payload.executionId) {
        await replayRecentExecutions(1);
      } else {
        await replayRecentExecutions(job.payload.limit ?? 30);
      }
      await prisma.executionMgmtJobState.upsert({
        where: { jobType: "EXECUTION_REPLAY" },
        create: { jobType: "EXECUTION_REPLAY", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  executionMgmtQueue.register<Extract<ExecutionMgmtJobPayload, { type: "STATISTICS_AGGREGATE" }>>(
    "STATISTICS_AGGREGATE",
    async (job) => {
      await aggregateExecutionStatistics(job.payload.periodHours ?? 24);
      await prisma.executionMgmtJobState.upsert({
        where: { jobType: "STATISTICS_AGGREGATE" },
        create: { jobType: "STATISTICS_AGGREGATE", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );
}

export async function enqueueExecutionMgmtJob(payload: ExecutionMgmtJobPayload) {
  registerExecutionMgmtQueueHandlers();
  return executionMgmtQueue.push(payload.type, payload);
}

export function startExecutionMgmtQueue() {
  registerExecutionMgmtQueueHandlers();
  void executionMgmtQueue.start();
  return executionMgmtQueue.stats();
}
