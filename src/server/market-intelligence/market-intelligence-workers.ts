import { logger } from "@/lib/logger";
import { enqueueMarketIntelJob, startMarketIntelQueue } from "@/src/server/market-intelligence/market-intelligence-queue";

type WorkerTimer = ReturnType<typeof setInterval>;
const timers: WorkerTimer[] = [];
let started = false;

const SCHEDULES = {
  collectorMs: 60_000,
  validatorMs: 10 * 60_000,
  cleanupMs: 6 * 60 * 60_000,
  compressionMs: 15 * 60_000,
  aggregatorMs: 30 * 60_000,
};

export function ensureMarketIntelWorkersStarted() {
  if (started) return { running: true, schedules: SCHEDULES };
  started = true;
  startMarketIntelQueue();

  timers.push(
    setInterval(() => {
      void enqueueMarketIntelJob({ type: "CAPTURE_BATCH", limit: 25 }).catch((error) =>
        logger.warn({ error: (error as Error).message }, "Snapshot collector failed"),
      );
    }, SCHEDULES.collectorMs),
  );
  timers.push(
    setInterval(() => {
      void enqueueMarketIntelJob({ type: "VALIDATE_SNAPSHOTS", limit: 200 }).catch(() => null);
    }, SCHEDULES.validatorMs),
  );
  timers.push(
    setInterval(() => {
      void enqueueMarketIntelJob({ type: "CLEANUP_RETENTION" }).catch(() => null);
    }, SCHEDULES.cleanupMs),
  );
  timers.push(
    setInterval(() => {
      void enqueueMarketIntelJob({ type: "COMPRESS_SNAPSHOTS", limit: 100 }).catch(() => null);
    }, SCHEDULES.compressionMs),
  );
  timers.push(
    setInterval(() => {
      void enqueueMarketIntelJob({ type: "AGGREGATE_HISTORICAL" }).catch(() => null);
    }, SCHEDULES.aggregatorMs),
  );

  void enqueueMarketIntelJob({ type: "CAPTURE_BATCH", limit: 10 }).catch(() => null);
  logger.info({ schedules: SCHEDULES }, "Market intelligence workers started");
  return { running: true, schedules: SCHEDULES };
}

export function getMarketIntelWorkerState() {
  return { running: started, schedules: SCHEDULES, timerCount: timers.length };
}
