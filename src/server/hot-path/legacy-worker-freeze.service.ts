import { env } from "@/lib/config";
import { LEGACY_WORKER_REGISTRY } from "@/src/server/hot-path/hot-path.registry";
import type { LegacyWorkerDefinition, WorkerRuntimeSnapshot, WorkerTier } from "@/src/server/hot-path/hot-path.types";

export function isLegacyWorkerEnabled(definition: LegacyWorkerDefinition): boolean {
  if (!env.SCANNER_WORKER_ENABLED) return false;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return false;

  if (env.HOT_PATH_LEGACY_WORKERS_ENABLED) return true;

  if (!env.HOT_PATH_V2_FREEZE_ENABLED) return true;

  return definition.tier === "CRITICAL";
}

export function getLegacyWorkerSkipReason(definition: LegacyWorkerDefinition): string | undefined {
  if (!env.SCANNER_WORKER_ENABLED) return "SCANNER_WORKER_ENABLED=false";
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return "APP_ROLE!=worker";
  if (env.HOT_PATH_LEGACY_WORKERS_ENABLED) return undefined;
  if (!env.HOT_PATH_V2_FREEZE_ENABLED) return undefined;
  if (definition.tier !== "CRITICAL") {
    return `frozen:${definition.tier.toLowerCase()}`;
  }
  return undefined;
}

export function getWorkerRegistryByTier(tier: WorkerTier) {
  return LEGACY_WORKER_REGISTRY.filter((worker) => worker.tier === tier);
}

export function getWorkerPolicySummary() {
  return {
    freezeEnabled: env.HOT_PATH_V2_FREEZE_ENABLED,
    legacyWorkersEnabled: env.HOT_PATH_LEGACY_WORKERS_ENABLED,
    maxCriticalWorkers: env.HOT_PATH_MAX_CRITICAL_WORKERS,
    scannerWorkerEnabled: env.SCANNER_WORKER_ENABLED,
    separateWorkerMode: env.ENABLE_SEPARATE_WORKER,
    appRole: env.APP_ROLE,
    criticalWorkers: getWorkerRegistryByTier("CRITICAL").map((w) => w.id),
    frozenWhenFreezeEnabled: LEGACY_WORKER_REGISTRY.filter((w) => w.tier !== "CRITICAL").map((w) => w.id),
  };
}

export function buildWorkerSnapshot(
  id: string,
  running: boolean,
): WorkerRuntimeSnapshot {
  const definition = LEGACY_WORKER_REGISTRY.find((w) => w.id === id);
  if (!definition) {
    return { id, label: id, tier: "OBSERVE_ONLY", enabled: false, running: false, skippedReason: "unknown_worker" };
  }
  const enabled = isLegacyWorkerEnabled(definition);
  return {
    id: definition.id,
    label: definition.label,
    tier: definition.tier,
    enabled,
    running: enabled && running,
    skippedReason: enabled ? undefined : getLegacyWorkerSkipReason(definition),
  };
}

export function validateCriticalWorkerBudget(activeCriticalCount: number) {
  if (!env.HOT_PATH_V2_FREEZE_ENABLED || env.HOT_PATH_LEGACY_WORKERS_ENABLED) return { ok: true as const };
  if (activeCriticalCount > env.HOT_PATH_MAX_CRITICAL_WORKERS) {
    return {
      ok: false as const,
      message: `Critical worker count ${activeCriticalCount} exceeds HOT_PATH_MAX_CRITICAL_WORKERS=${env.HOT_PATH_MAX_CRITICAL_WORKERS}`,
    };
  }
  return { ok: true as const };
}
