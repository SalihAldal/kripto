import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueueEventPlatformJob, startEventPlatformQueue } from "@/src/server/event-platform/event-platform-queue";
import { bootstrapEventSchemas } from "@/src/server/event-platform/schema-validator.service";
import { bootstrapModulePlugins } from "@/src/server/event-platform/plugin-registry.service";

type EventPlatformWorkerState = { running: boolean; startedAt?: string; intervalMs: number };
let timers: ReturnType<typeof setInterval>[] = [];
const state: EventPlatformWorkerState = { running: false, intervalMs: Math.max(60_000, env.SCANNER_WORKER_INTERVAL_MS) };

async function bootstrapPlatform() {
  await bootstrapEventSchemas().catch(() => null);
  await bootstrapModulePlugins().catch(() => null);
}

export function ensureEventPlatformWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startEventPlatformQueue();
  void bootstrapPlatform();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Event platform workers baslatildi. interval=${state.intervalMs}ms`);

  timers.push(setInterval(() => void enqueueEventPlatformJob({ type: "RETRY" }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueEventPlatformJob({ type: "DEAD_LETTER_PROCESS" }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueEventPlatformJob({ type: "CHECKPOINT_SYNC" }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueEventPlatformJob({ type: "OBSERVABILITY_SNAPSHOT" }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueEventPlatformJob({ type: "EVENT_CLEANUP" }).catch(() => null), state.intervalMs * 24));
  timers.push(setInterval(() => void enqueueEventPlatformJob({ type: "SCHEMA_VALIDATE" }).catch(() => null), state.intervalMs * 12));

  return state;
}

export function getEventPlatformWorkerState() {
  return { ...state };
}

export function stopEventPlatformWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
