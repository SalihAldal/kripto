import type { AiProviderHealthState } from "@/src/server/ai/ai-provider-health.service";

export type ProviderRegistryHealthState = AiProviderHealthState | "UNKNOWN";

export type ProviderRegistryEntry = {
  providerId: string;
  healthState: ProviderRegistryHealthState;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastFailureReason?: string;
  consecutiveFailures: number;
};

const STALE_FAILURE_MS = 30 * 60 * 1000;

const registry = new Map<string, ProviderRegistryEntry>();

function createEntry(providerId: string): ProviderRegistryEntry {
  return {
    providerId,
    healthState: "UNKNOWN",
    consecutiveFailures: 0,
  };
}

export function getProviderRegistryEntry(providerId: string): ProviderRegistryEntry {
  const existing = registry.get(providerId);
  if (existing) return { ...existing };
  return createEntry(providerId);
}

export function resetStaleProviderHealth(providerId: string, staleMs = STALE_FAILURE_MS): boolean {
  const entry = registry.get(providerId);
  if (!entry?.lastFailureAt) return false;
  const age = Date.now() - Date.parse(entry.lastFailureAt);
  if (age < staleMs) return false;
  if (entry.healthState === "HEALTHY") return false;
  entry.healthState = entry.lastSuccessAt ? "DEGRADED" : "UNKNOWN";
  entry.lastFailureReason = undefined;
  entry.consecutiveFailures = 0;
  registry.set(providerId, entry);
  return true;
}

export function recordProviderOutcome(input: {
  providerId: string;
  ok: boolean;
  remoteOk: boolean;
  healthState: AiProviderHealthState;
  error?: string;
  failureCategory?: string;
}): ProviderRegistryEntry {
  const now = new Date().toISOString();
  const entry = registry.get(input.providerId) ?? createEntry(input.providerId);
  entry.lastAttemptAt = now;

  if (input.remoteOk && input.ok) {
    entry.healthState = "HEALTHY";
    entry.lastSuccessAt = now;
    entry.consecutiveFailures = 0;
    entry.lastFailureReason = undefined;
  } else if (input.ok && !input.remoteOk) {
    if (entry.healthState === "UNKNOWN") entry.healthState = "DEGRADED";
    resetStaleProviderHealth(input.providerId);
  } else {
    entry.healthState = input.healthState;
    entry.lastFailureAt = now;
    entry.lastFailureReason = input.error ?? input.failureCategory ?? input.healthState;
    entry.consecutiveFailures += 1;
  }

  registry.set(input.providerId, entry);
  return { ...entry };
}

export function listProviderRegistrySnapshots(): ProviderRegistryEntry[] {
  return Array.from(registry.values()).map((row) => ({ ...row }));
}

export function clearProviderRegistryForTests() {
  registry.clear();
}

export function mutateProviderRegistryForTests(providerId: string, patch: Partial<ProviderRegistryEntry>) {
  const entry = registry.get(providerId) ?? createEntry(providerId);
  Object.assign(entry, patch);
  registry.set(providerId, entry);
  return { ...entry };
}
