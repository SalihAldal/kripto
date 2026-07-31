import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { pushLog } from "@/services/log.service";
import { markHeartbeat } from "@/src/server/observability/heartbeat";
import {
  enqueueTradingCoreS2Job,
  startTradingCoreS2Queue,
} from "@/src/server/trading-core-s2/trading-core-s2.queue";
import { hydrateTradingCoreS2CacheFromDb } from "@/src/server/trading-core-s2/trading-core-s2.bootstrap";

type TradingCoreS2WorkerState = {
  running: boolean;
  startedAt?: string;
  intervalMs: number;
  lastRegimeAt?: string;
  lastDiscoveryAt?: string;
  lastMomentumAt?: string;
  lastStatisticsAt?: string;
  lastError?: string;
};

let timers: ReturnType<typeof setInterval>[] = [];
let runLock = false;
const state: TradingCoreS2WorkerState = {
  running: false,
  intervalMs: Math.max(60_000, env.REGIME_REFRESH_INTERVAL_MS),
};

async function guardedEnqueue(label: string, fn: () => Promise<unknown>) {
  if (runLock) return;
  runLock = true;
  try {
    await fn();
    state.lastError = undefined;
    markHeartbeat({ service: "trading-core-s2", status: "UP", message: `${label} completed` });
  } catch (error) {
    state.lastError = (error as Error).message;
    logger.warn({ error: state.lastError, label }, "Trading core s2 worker job failed");
    markHeartbeat({ service: "trading-core-s2", status: "DEGRADED", message: state.lastError });
  } finally {
    runLock = false;
  }
}

export function ensureTradingCoreS2WorkersStarted() {
  if (!env.TRADING_CORE_S2_ENABLED) return state;
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startTradingCoreS2Queue();
  void hydrateTradingCoreS2CacheFromDb().catch(() => null);
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Trading Core S2 workers baslatildi. interval=${state.intervalMs}ms`);

  void guardedEnqueue("REGIME_REFRESH", async () => {
    await enqueueTradingCoreS2Job({ type: "REGIME_REFRESH" });
    state.lastRegimeAt = new Date().toISOString();
  });

  void guardedEnqueue("DISCOVERY_SCAN", async () => {
    await enqueueTradingCoreS2Job({ type: "REGIME_REFRESH" });
    await enqueueTradingCoreS2Job({ type: "DISCOVERY_SCAN", limit: env.DISCOVERY_V2_CYCLE_LIMIT });
    state.lastDiscoveryAt = new Date().toISOString();
  });

  timers.push(
    setInterval(() => {
      void guardedEnqueue("REGIME_REFRESH", async () => {
        await enqueueTradingCoreS2Job({ type: "REGIME_REFRESH" });
        state.lastRegimeAt = new Date().toISOString();
      });
    }, state.intervalMs),
  );

  timers.push(
    setInterval(() => {
      void guardedEnqueue("DISCOVERY_SCAN", async () => {
        await enqueueTradingCoreS2Job({ type: "DISCOVERY_SCAN", limit: env.DISCOVERY_V2_CYCLE_LIMIT });
        state.lastDiscoveryAt = new Date().toISOString();
      });
    }, state.intervalMs * 2),
  );

  timers.push(
    setInterval(() => {
      void guardedEnqueue("MOMENTUM_EVALUATE", async () => {
        await enqueueTradingCoreS2Job({ type: "MOMENTUM_EVALUATE", limit: env.DISCOVERY_V2_TOP_N });
        state.lastMomentumAt = new Date().toISOString();
      });
    }, state.intervalMs * 3),
  );

  timers.push(
    setInterval(() => {
      void guardedEnqueue("STATISTICS_UPDATE", async () => {
        await enqueueTradingCoreS2Job({ type: "STATISTICS_UPDATE" });
        state.lastStatisticsAt = new Date().toISOString();
      });
    }, state.intervalMs * 6),
  );

  return state;
}

export function getTradingCoreS2WorkerState() {
  return { ...state };
}

export function stopTradingCoreS2Workers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
