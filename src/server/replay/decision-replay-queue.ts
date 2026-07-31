import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { replayDecision } from "@/src/server/replay/decision-replay.engine";
import {
  listPendingDecisionLogs,
  listRejectedDecisions,
  upsertReplayJobState,
} from "@/src/server/replay/decision-replay.repository";
import { runFullStatisticsAggregation } from "@/src/server/replay/replay-statistics.service";
import { generateWeightRecommendations } from "@/src/server/replay/weight-recommendation.service";
import type { ReplayJobPayload } from "@/src/server/replay/replay.types";
import { prisma } from "@/src/server/db/prisma";
import type { ReplayJobCadence } from "@prisma/client";

const MAX_RETRIES = 3;

export const decisionReplayQueue = new TradingJobQueue(
  "decision-replay",
  2,
  Boolean(env.REDIS_URL),
);

function periodForCadence(cadence: ReplayJobCadence) {
  const now = Date.now();
  if (cadence === "DAILY") return new Date(now - 24 * 60 * 60_000);
  if (cadence === "WEEKLY") return new Date(now - 7 * 24 * 60 * 60_000);
  if (cadence === "MONTHLY") return new Date(now - 30 * 24 * 60 * 60_000);
  return new Date(now - 24 * 60 * 60_000);
}

async function handleReplaySingle(payload: Extract<ReplayJobPayload, { type: "REPLAY_SINGLE" }>, attempts: number) {
  if (attempts > MAX_RETRIES) return;
  await replayDecision({ decisionId: payload.decisionId, cadence: payload.cadence });
}

async function handleReplayBatch(payload: Extract<ReplayJobPayload, { type: "REPLAY_BATCH" }>, attempts: number) {
  if (attempts > MAX_RETRIES) return;
  const rows = await listPendingDecisionLogs({
    limit: payload.limit ?? 50,
    since: payload.since ? new Date(payload.since) : undefined,
    cursor: payload.resumeCursor,
  });

  let lastId: string | undefined;
  for (const row of rows) {
    lastId = row.id;
    try {
      await replayDecision({ decisionId: row.decisionId, cadence: payload.cadence ?? "INCREMENTAL" });
    } catch (error) {
      logger.warn({ decisionId: row.decisionId, error: (error as Error).message }, "Batch replay item failed");
    }
  }

  await upsertReplayJobState({
    jobType: "REPLAY_BATCH",
    cadence: payload.cadence ?? "INCREMENTAL",
    lastProcessedAt: new Date(),
    lastDecisionId: rows[rows.length - 1]?.decisionId,
    cursor: lastId,
    status: rows.length > 0 ? "COMPLETED" : "IDLE",
  });

  if (rows.length >= (payload.limit ?? 50) && lastId) {
    await enqueueReplayJob({
      type: "REPLAY_BATCH",
      limit: payload.limit,
      since: payload.since,
      cadence: payload.cadence,
      resumeCursor: lastId,
    });
  }
}

async function handleCadenceReplay(cadence: ReplayJobCadence, jobType: ReplayJobPayload["type"]) {
  const since = periodForCadence(cadence);
  await enqueueReplayJob({ type: "REPLAY_BATCH", since: since.toISOString(), cadence, limit: 100 });
  await upsertReplayJobState({
    jobType: jobType as "REPLAY_DAILY" | "REPLAY_WEEKLY" | "REPLAY_MONTHLY",
    cadence,
    lastProcessedAt: new Date(),
    status: "QUEUED",
  });
}

async function handleEvaluateRejected(payload: Extract<ReplayJobPayload, { type: "EVALUATE_REJECTED" }>) {
  const rows = await listRejectedDecisions({ limit: payload.limit ?? 100, since: periodForCadence("DAILY") });
  for (const row of rows) {
    await enqueueReplayJob({ type: "REPLAY_SINGLE", decisionId: row.decisionId, cadence: "REJECTED_SCAN" });
  }
  await upsertReplayJobState({
    jobType: "EVALUATE_REJECTED",
    cadence: "REJECTED_SCAN",
    lastProcessedAt: new Date(),
    status: "QUEUED",
    metadata: { queued: rows.length },
  });
}

async function handleScanMissedOpportunities() {
  const rows = await prisma.missedOpportunity.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  await upsertReplayJobState({
    jobType: "SCAN_MISSED_OPPORTUNITIES",
    lastProcessedAt: new Date(),
    status: "COMPLETED",
    metadata: { scanned: rows.length },
  });
  return rows.length;
}

async function handleAggregateStatistics(payload: Extract<ReplayJobPayload, { type: "AGGREGATE_STATISTICS" }>) {
  const result = await runFullStatisticsAggregation({
    periodDays: payload.periodDays,
    cadence: payload.cadence,
  });
  await generateWeightRecommendations();
  await upsertReplayJobState({
    jobType: "AGGREGATE_STATISTICS",
    cadence: payload.cadence ?? "DAILY",
    lastProcessedAt: new Date(),
    status: "COMPLETED",
    metadata: result,
  });
}

let handlersRegistered = false;

export function registerDecisionReplayQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  decisionReplayQueue.register<Extract<ReplayJobPayload, { type: "REPLAY_SINGLE" }>>("REPLAY_SINGLE", async (job) =>
    handleReplaySingle(job.payload, job.attempts),
  );
  decisionReplayQueue.register<Extract<ReplayJobPayload, { type: "REPLAY_BATCH" }>>("REPLAY_BATCH", async (job) =>
    handleReplayBatch(job.payload, job.attempts),
  );
  decisionReplayQueue.register("REPLAY_DAILY", async () => handleCadenceReplay("DAILY", "REPLAY_DAILY"));
  decisionReplayQueue.register("REPLAY_WEEKLY", async () => handleCadenceReplay("WEEKLY", "REPLAY_WEEKLY"));
  decisionReplayQueue.register("REPLAY_MONTHLY", async () => handleCadenceReplay("MONTHLY", "REPLAY_MONTHLY"));
  decisionReplayQueue.register<Extract<ReplayJobPayload, { type: "EVALUATE_REJECTED" }>>("EVALUATE_REJECTED", async (job) =>
    handleEvaluateRejected(job.payload),
  );
  decisionReplayQueue.register("SCAN_MISSED_OPPORTUNITIES", async () => {
    await handleScanMissedOpportunities();
  });
  decisionReplayQueue.register<Extract<ReplayJobPayload, { type: "AGGREGATE_STATISTICS" }>>("AGGREGATE_STATISTICS", async (job) =>
    handleAggregateStatistics(job.payload),
  );
}

export async function enqueueReplayJob(payload: ReplayJobPayload) {
  registerDecisionReplayQueueHandlers();
  return decisionReplayQueue.push(payload.type, payload);
}

export function startDecisionReplayQueue() {
  registerDecisionReplayQueueHandlers();
  void decisionReplayQueue.start();
  return decisionReplayQueue.stats();
}

export function stopDecisionReplayQueue() {
  decisionReplayQueue.stop();
}

export async function scheduleReplayJobs(input?: { cadence?: ReplayJobCadence }) {
  const cadence = input?.cadence ?? "INCREMENTAL";
  await enqueueReplayJob({ type: "REPLAY_BATCH", cadence, limit: 50 });
  await enqueueReplayJob({ type: "AGGREGATE_STATISTICS", cadence: "DAILY", periodDays: 7 });
}
