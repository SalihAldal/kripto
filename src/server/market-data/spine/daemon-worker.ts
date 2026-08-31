import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";

type DaemonWorkerState = {
  running: boolean;
  startedAt?: string;
};

const state: DaemonWorkerState = { running: false };

export function ensureMarketDataDaemonStarted() {
  if (state.running) return state;
  if (!env.SCANNER_WORKER_ENABLED) return state;
  const daemon = getMarketDataDaemon();
  void daemon.start().catch((error) => {
    logger.error({ err: error }, "MarketDataDaemon failed to start");
  });
  state.running = true;
  state.startedAt = new Date().toISOString();
  return state;
}

export function getMarketDataDaemonWorkerState() {
  return { ...state, telemetry: getMarketDataDaemon().telemetry() };
}
