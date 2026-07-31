import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { pushLog } from "@/services/log.service";
import { markHeartbeat } from "@/src/server/observability/heartbeat";
import { enqueueDiscoveryJob, registerDiscoveryQueueHandlers, startDiscoveryQueue } from "@/src/server/discovery/discovery-queue";
import { ensureTradingCoreS2WorkersStarted } from "@/src/server/trading-core-s2/trading-core-s2.workers";

type DiscoveryWorkerState = {
  running: boolean;
  startedAt?: string;
  lastCycleAt?: string;
  lastUniverseSyncAt?: string;
  lastRankingAt?: string;
  lastError?: string;
  intervalMs: number;
};

let timers: ReturnType<typeof setInterval>[] = [];
let runLock = false;
const state: DiscoveryWorkerState = {
  running: false,
  intervalMs: Math.max(15_000, env.SCANNER_WORKER_INTERVAL_MS * 2),
};

async function runDiscoveryCycle() {
  if (runLock) return;
  runLock = true;
  try {
    await enqueueDiscoveryJob({ type: "DISCOVERY_CYCLE", limit: env.SCANNER_CYCLE_SYMBOL_LIMIT ?? 120 });
    state.lastCycleAt = new Date().toISOString();
    state.lastError = undefined;
    markHeartbeat({ service: "discovery-worker", status: "UP", message: "Discovery cycle completed" });
  } catch (error) {
    state.lastError = (error as Error).message;
    logger.warn({ error: state.lastError }, "Discovery cycle failed");
    markHeartbeat({ service: "discovery-worker", status: "DEGRADED", message: state.lastError });
  } finally {
    runLock = false;
  }
}

async function runUniverseSync() {
  try {
    await enqueueDiscoveryJob({ type: "UNIVERSE_SYNC", limit: 5000 });
    state.lastUniverseSyncAt = new Date().toISOString();
  } catch (error) {
    logger.warn({ error: (error as Error).message }, "Universe sync failed");
  }
}

async function runRanking() {
  try {
    await enqueueDiscoveryJob({ type: "RANKING", limit: 200 });
    state.lastRankingAt = new Date().toISOString();
  } catch (error) {
    logger.warn({ error: (error as Error).message }, "Discovery ranking failed");
  }
}

async function runListingWatch() {
  try {
    await enqueueDiscoveryJob({ type: "LISTING_WATCH" });
  } catch (error) {
    logger.warn({ error: (error as Error).message }, "Listing watch failed");
  }
}

async function runHealthCheck() {
  try {
    await enqueueDiscoveryJob({ type: "HEALTH_CHECK", limit: 100 });
  } catch (error) {
    logger.warn({ error: (error as Error).message }, "Discovery health check failed");
  }
}

export function ensureDiscoveryWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  registerDiscoveryQueueHandlers();
  startDiscoveryQueue();
  if (env.TRADING_CORE_S2_ENABLED) {
    ensureTradingCoreS2WorkersStarted();
  }
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Discovery workers baslatildi. interval=${state.intervalMs}ms`);

  void runUniverseSync();
  void runDiscoveryCycle();
  void runHealthCheck();

  timers.push(
    setInterval(() => {
      void runDiscoveryCycle();
    }, state.intervalMs),
  );
  timers.push(
    setInterval(() => {
      void runRanking();
    }, state.intervalMs * 2),
  );
  timers.push(
    setInterval(() => {
      void runUniverseSync();
    }, 60 * 60 * 1000),
  );
  timers.push(
    setInterval(() => {
      void runListingWatch();
    }, 15 * 60 * 1000),
  );
  timers.push(
    setInterval(() => {
      void runHealthCheck();
    }, 5 * 60 * 1000),
  );

  return state;
}

export function getDiscoveryWorkerState() {
  return { ...state };
}

export function stopDiscoveryWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
