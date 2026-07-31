import { logger } from "@/lib/logger";
import { enqueueReplayJob, startDecisionReplayQueue } from "@/src/server/replay/decision-replay-queue";
import { upsertReplayJobState } from "@/src/server/replay/decision-replay.repository";

type WorkerTimer = ReturnType<typeof setInterval>;

const timers: WorkerTimer[] = [];
let started = false;

const SCHEDULES = {
  incrementalMs: 5 * 60_000,
  dailyMs: 24 * 60 * 60_000,
  weeklyMs: 7 * 24 * 60 * 60_000,
  monthlyMs: 30 * 24 * 60 * 60_000,
  rejectedMs: 15 * 60_000,
  missedOpportunityMs: 30 * 60_000,
  statisticsMs: 60 * 60_000,
};

async function safeEnqueue(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    logger.warn({ worker: label, error: (error as Error).message }, "Replay worker enqueue failed");
  }
}

export function ensureDecisionReplayWorkersStarted() {
  if (started) return { running: true, schedules: SCHEDULES };
  started = true;

  startDecisionReplayQueue();

  timers.push(
    setInterval(() => {
      void safeEnqueue("incremental-replay", () =>
        enqueueReplayJob({ type: "REPLAY_BATCH", cadence: "INCREMENTAL", limit: 25 }),
      );
    }, SCHEDULES.incrementalMs),
  );

  timers.push(
    setInterval(() => {
      void safeEnqueue("daily-replay", () => enqueueReplayJob({ type: "REPLAY_DAILY" }));
    }, SCHEDULES.dailyMs),
  );

  timers.push(
    setInterval(() => {
      void safeEnqueue("weekly-replay", () => enqueueReplayJob({ type: "REPLAY_WEEKLY" }));
    }, SCHEDULES.weeklyMs),
  );

  timers.push(
    setInterval(() => {
      void safeEnqueue("monthly-replay", () => enqueueReplayJob({ type: "REPLAY_MONTHLY" }));
    }, SCHEDULES.monthlyMs),
  );

  timers.push(
    setInterval(() => {
      void safeEnqueue("rejected-evaluator", () =>
        enqueueReplayJob({ type: "EVALUATE_REJECTED", limit: 50 }),
      );
    }, SCHEDULES.rejectedMs),
  );

  timers.push(
    setInterval(() => {
      void safeEnqueue("missed-opportunity-scanner", () =>
        enqueueReplayJob({ type: "SCAN_MISSED_OPPORTUNITIES" }),
      );
    }, SCHEDULES.missedOpportunityMs),
  );

  timers.push(
    setInterval(() => {
      void safeEnqueue("statistics-aggregator", () =>
        enqueueReplayJob({ type: "AGGREGATE_STATISTICS", cadence: "DAILY", periodDays: 7 }),
      );
    }, SCHEDULES.statisticsMs),
  );

  void upsertReplayJobState({ jobType: "REPLAY_BATCH", status: "RUNNING", lastProcessedAt: new Date() });
  void safeEnqueue("boot-incremental", () =>
    enqueueReplayJob({ type: "REPLAY_BATCH", cadence: "INCREMENTAL", limit: 10 }),
  );

  logger.info({ schedules: SCHEDULES }, "Decision replay workers started");
  return { running: true, schedules: SCHEDULES };
}

export function stopDecisionReplayWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
  started = false;
}

export function getDecisionReplayWorkerState() {
  return { running: started, schedules: SCHEDULES, timerCount: timers.length };
}
