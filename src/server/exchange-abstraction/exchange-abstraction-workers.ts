import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueueExchangeAbstractionJob, startExchangeAbstractionQueue } from "@/src/server/exchange-abstraction/exchange-abstraction-queue";
import { connectExchange } from "@/src/server/exchange-abstraction/connection-manager.service";
import { upsertExchangeRegistry, upsertExchangeCapability } from "@/src/server/exchange-abstraction/exchange-abstraction.repository";
import { getProductionAdapter } from "@/src/server/exchange-abstraction/plugin-registry.service";

type ExchangeAbstractionWorkerState = { running: boolean; startedAt?: string; intervalMs: number };
let timers: ReturnType<typeof setInterval>[] = [];
const state: ExchangeAbstractionWorkerState = { running: false, intervalMs: Math.max(60_000, env.SCANNER_WORKER_INTERVAL_MS) };

async function bootstrapProductionRegistry() {
  const adapter = getProductionAdapter();
  const registry = await upsertExchangeRegistry({
    pluginType: "BINANCE_SPOT",
    displayName: adapter.displayName,
    isProduction: true,
    enabled: true,
  });
  await upsertExchangeCapability(registry.id, adapter.getCapabilities());
  await connectExchange("BINANCE_SPOT").catch(() => null);
}

export function ensureExchangeAbstractionWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startExchangeAbstractionQueue();
  void bootstrapProductionRegistry();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Exchange abstraction workers baslatildi. interval=${state.intervalMs}ms`);

  timers.push(setInterval(() => void enqueueExchangeAbstractionJob({ type: "HEALTH_CHECK" }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueExchangeAbstractionJob({ type: "SYMBOL_SYNC" }).catch(() => null), state.intervalMs * 6));
  timers.push(setInterval(() => void enqueueExchangeAbstractionJob({ type: "BALANCE_SYNC" }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueExchangeAbstractionJob({ type: "CONNECTION_MONITOR" }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueExchangeAbstractionJob({ type: "RATE_LIMIT_SYNC" }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueExchangeAbstractionJob({ type: "RECONNECT" }).catch(() => null), state.intervalMs * 12));
  timers.push(setInterval(() => void enqueueExchangeAbstractionJob({ type: "LATENCY_PROBE" }).catch(() => null), state.intervalMs * 5));

  return state;
}

export function getExchangeAbstractionWorkerState() {
  return { ...state };
}

export function stopExchangeAbstractionWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
