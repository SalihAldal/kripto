import { env } from "@/lib/config";
import { CANONICAL_AUTHORITY_OWNERS } from "@/src/server/hot-path/canonical-pipeline";

export type CriticalWorkerOwnership = {
  id: string;
  ownership: string;
  claimedAt: string;
};

const claimedCriticalWorkers = new Map<string, CriticalWorkerOwnership>();

export const CANONICAL_CRITICAL_WORKER_IDS = ["market-data-daemon", "scanner", "execution-engine-v2"] as const;

export function getCanonicalCriticalWorkerIds(): string[] {
  return [...CANONICAL_CRITICAL_WORKER_IDS];
}

export function claimCriticalWorker(id: string): { ok: true } | { ok: false; reason: string } {
  const existing = claimedCriticalWorkers.get(id);
  if (existing) {
    return { ok: false, reason: "DUPLICATE_CRITICAL_WORKER" };
  }
  if (claimedCriticalWorkers.size >= env.HOT_PATH_MAX_CRITICAL_WORKERS && !claimedCriticalWorkers.has(id)) {
    return { ok: false, reason: "CRITICAL_WORKER_BUDGET_EXCEEDED" };
  }
  claimedCriticalWorkers.set(id, {
    id,
    ownership: resolveOwnershipLabel(id),
    claimedAt: new Date().toISOString(),
  });
  return { ok: true };
}

export function hasCriticalWorkerClaim(id: string): boolean {
  return claimedCriticalWorkers.has(id);
}

export function getClaimedCriticalWorkers(): CriticalWorkerOwnership[] {
  return [...claimedCriticalWorkers.values()];
}

export function getClaimedCriticalWorkerCount(): number {
  return claimedCriticalWorkers.size;
}

export function releaseCriticalWorker(id: string): void {
  claimedCriticalWorkers.delete(id);
}

export function resetCriticalWorkerOwnershipForTests(): void {
  claimedCriticalWorkers.clear();
}

function resolveOwnershipLabel(id: string): string {
  if (id === "market-data-daemon") return CANONICAL_AUTHORITY_OWNERS.MARKET_DATA;
  if (id === "scanner") return CANONICAL_AUTHORITY_OWNERS.MARKET_SCANNING;
  if (id === "execution-engine-v2") return CANONICAL_AUTHORITY_OWNERS.EXECUTION;
  return id;
}
