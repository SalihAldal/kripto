import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CircuitOpenError } from "@/src/server/errors";
import {
  buildExecutionBreakerKey,
  classifyExecutionFailure,
  type CanonicalExecutionFailure,
  type ExecutionFailureDomain,
} from "@/src/server/execution/execution-failure-contract";

export type BreakerDomain = ExecutionFailureDomain;
export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

type FailureClass = {
  domain: BreakerDomain;
  code: string;
  retryable: boolean;
  breakerEligible: boolean;
  statusCode: number | null;
  retryAfterMs: number | null;
  context: string;
  canonical: CanonicalExecutionFailure;
};

type CircuitState = {
  key: string;
  domain: BreakerDomain;
  operation: string;
  dependency: string;
  venue: string;
  state: BreakerState;
  failureCount: number;
  consecutiveFailures: number;
  threshold: number;
  cooldownMs: number;
  openedAt: number;
  openUntil: number;
  lastFailureAt: number;
  lastSuccessAt: number;
  resetCount: number;
  lastFailureCode: string;
  lastFailureMessage: string;
  openCount: number;
  halfOpenProbeCount: number;
  halfOpenSuccess: number;
  halfOpenFailure: number;
  probeInFlight: boolean;
};

const circuits = new Map<string, CircuitState>();
const MAX_BACKOFF_MS = 5 * 60_000;
let hydrationChecked = false;
const breakerEvents: Array<{
  type: "BREAKER_OPENED" | "BREAKER_HALF_OPEN" | "BREAKER_RECOVERED";
  key: string;
  domain: BreakerDomain;
  operation: string;
  dependency: string;
  venue: string;
  timestamp: string;
  failureCode?: string;
}> = [];

function isBreakerPersistenceEnabled() {
  if (process.env.KRIPTO_BREAKER_PERSIST === "1") return true;
  if (process.env.KRIPTO_BREAKER_PERSIST === "0") return false;
  return process.env.NODE_ENV !== "test";
}

function resolveBreakerStatePath() {
  const customPath = String(process.env.KRIPTO_BREAKER_STATE_PATH ?? "").trim();
  if (customPath) return customPath;
  return path.join(/* turbopackIgnore: true */ process.cwd(), "artifacts", "runtime", "circuit-breaker-state.json");
}

type PersistedCircuitState = ReturnType<typeof getCircuitSnapshot>[number];

function applyHydrationSnapshot(snapshot: PersistedCircuitState[]) {
  circuits.clear();
  for (const row of snapshot) {
    const key = String(row.key ?? "").trim();
    if (!key) continue;
    circuits.set(key, {
      key,
      domain: row.domain,
      operation: row.operation,
      dependency: row.dependency,
      venue: row.venue,
      state: row.state,
      failureCount: Number(row.failureCount ?? 0),
      consecutiveFailures: Number(row.consecutiveFailures ?? 0),
      threshold: Number(row.threshold ?? 4),
      cooldownMs: Number(row.cooldownMs ?? 30_000),
      openedAt: row.openedAt ? Date.parse(row.openedAt) : 0,
      openUntil: row.openUntil ? Date.parse(row.openUntil) : 0,
      lastFailureAt: row.lastFailureAt ? Date.parse(row.lastFailureAt) : 0,
      lastSuccessAt: row.lastSuccessAt ? Date.parse(row.lastSuccessAt) : 0,
      resetCount: Number(row.resetCount ?? 0),
      lastFailureCode: String(row.lastFailureCode ?? ""),
      lastFailureMessage: String(row.lastFailureMessage ?? ""),
      openCount: Number(row.openCount ?? 0),
      halfOpenProbeCount: Number(row.halfOpenProbeCount ?? 0),
      halfOpenSuccess: Number(row.halfOpenSuccess ?? 0),
      halfOpenFailure: Number(row.halfOpenFailure ?? 0),
      probeInFlight: false,
    });
  }
}

function ensureHydratedFromDisk() {
  if (hydrationChecked || !isBreakerPersistenceEnabled()) return;
  hydrationChecked = true;
  try {
    const file = resolveBreakerStatePath();
    if (!existsSync(file)) return;
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return;
    applyHydrationSnapshot(parsed as PersistedCircuitState[]);
  } catch {
    circuits.clear();
  }
}

function persistCircuitsToDisk() {
  if (!isBreakerPersistenceEnabled()) return;
  try {
    const file = resolveBreakerStatePath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(getCircuitSnapshot(), null, 2)}\n`, "utf8");
  } catch {
    // persistence is best-effort, runtime safety should continue
  }
}

function emitBreakerEvent(
  circuit: CircuitState,
  type: "BREAKER_OPENED" | "BREAKER_HALF_OPEN" | "BREAKER_RECOVERED",
  failureCode?: string,
) {
  breakerEvents.unshift({
    type,
    key: circuit.key,
    domain: circuit.domain,
    operation: circuit.operation,
    dependency: circuit.dependency,
    venue: circuit.venue,
    timestamp: new Date().toISOString(),
    failureCode,
  });
  if (breakerEvents.length > 500) breakerEvents.pop();
}

function parseStatusCode(message: string): number | null {
  const matched = message.match(/\b(418|429|5\d{2}|4\d{2})\b/);
  if (!matched?.[1]) return null;
  const value = Number(matched[1]);
  return Number.isFinite(value) ? value : null;
}

function parseRetryAfterMs(message: string): number | null {
  const retry = message.match(/retry[- ]?after[^0-9]*(\d+)/i);
  if (!retry?.[1]) return null;
  const sec = Number(retry[1]);
  return Number.isFinite(sec) ? sec * 1000 : null;
}

function classifyFailure(
  error: unknown,
  key: string,
  circuit: Pick<CircuitState, "domain" | "operation" | "dependency" | "venue" | "state" | "openUntil">,
): FailureClass {
  const message = String((error as Error)?.message ?? "UNKNOWN_ERROR");
  const canonical = classifyExecutionFailure(error, {
    domainHint: circuit.domain,
    operation: circuit.operation,
    dependency: circuit.dependency,
    venue: circuit.venue,
    breakerState: circuit.state,
    openUntil: circuit.openUntil ? new Date(circuit.openUntil).toISOString() : null,
  });
  const retryAfterMs = parseRetryAfterMs(message);
  return {
    domain: canonical.failureDomain,
    code: canonical.failureCode,
    retryable: canonical.retryable,
    breakerEligible: canonical.breakerEligible,
    statusCode: canonical.statusCode ?? parseStatusCode(message),
    retryAfterMs,
    context: key,
    canonical,
  };
}

function inferDomain(key: string): BreakerDomain {
  const lower = key.toLowerCase();
  if (lower.includes("ai:") || lower.includes("openai") || lower.includes("anthropic") || lower.includes("gemini")) {
    return "AI_PROVIDER";
  }
  if (lower.includes("marketdata") || lower.includes("market-data")) return "MARKET_DATA";
  if (lower.includes("exchangeinfo") || lower.includes("metadata")) return "EXCHANGE_INFO";
  if (lower.includes("balance") || lower.includes("account")) return "BALANCE";
  if (lower.includes("redis")) return "REDIS";
  if (lower.includes("prisma") || lower.includes("database")) return "DATABASE";
  if (lower.includes("paper")) return "PAPER_EXECUTION";
  if (lower.includes("place") || lower.includes("order") || lower.includes("execution")) return "LIVE_EXECUTION";
  return "UNKNOWN";
}

function nextBackoffMs(circuit: CircuitState, failure: FailureClass): number {
  if (failure.statusCode === 418) {
    return Math.max(circuit.cooldownMs * 2, 15 * 60_000);
  }
  const retryAfter = failure.retryAfterMs ?? 0;
  const exponential = circuit.cooldownMs * Math.min(2 ** Math.max(circuit.consecutiveFailures - 1, 0), 16);
  return Math.min(MAX_BACKOFF_MS, Math.max(circuit.cooldownMs, retryAfter, exponential));
}

function getCircuit(
  key: string,
  threshold: number,
  cooldownMs: number,
  input?: { domain?: BreakerDomain; operation?: string; dependency?: string; venue?: string },
): CircuitState {
  ensureHydratedFromDisk();
  const current = circuits.get(key);
  if (current) return current;
  const created: CircuitState = {
    key,
    domain: input?.domain ?? inferDomain(key),
    operation: input?.operation ?? key,
    dependency: input?.dependency ?? key.split(":")[0] ?? "unknown",
    venue: input?.venue ?? "default",
    state: "CLOSED",
    failureCount: 0,
    consecutiveFailures: 0,
    threshold,
    cooldownMs,
    openedAt: 0,
    openUntil: 0,
    lastFailureAt: 0,
    lastSuccessAt: 0,
    resetCount: 0,
    lastFailureCode: "",
    lastFailureMessage: "",
    openCount: 0,
    halfOpenProbeCount: 0,
    halfOpenSuccess: 0,
    halfOpenFailure: 0,
    probeInFlight: false,
  };
  circuits.set(key, created);
  persistCircuitsToDisk();
  return created;
}

function toOpenError(circuit: CircuitState, reason: string) {
  const retryInMs = Math.max(0, circuit.openUntil - Date.now());
  return new CircuitOpenError(`Circuit is open for ${circuit.key}: ${reason}`, {
    key: circuit.key,
    retryInMs,
    domain: circuit.domain,
    state: circuit.state,
  });
}

export async function withCircuitBreaker<T>(
  key: string,
  action: () => Promise<T>,
  options?: {
    threshold?: number;
    cooldownMs?: number;
    domain?: BreakerDomain;
    operation?: string;
    dependency?: string;
    venue?: string;
  },
): Promise<T> {
  const threshold = options?.threshold ?? 4;
  const cooldownMs = options?.cooldownMs ?? 30_000;
  const domain = options?.domain ?? inferDomain(key);
  const operation = options?.operation ?? key;
  const dependency = options?.dependency ?? key.split(":")[0] ?? "unknown";
  const venue = options?.venue ?? "default";
  const isolatedKey = buildExecutionBreakerKey({
    failureDomain: domain,
    operation,
    dependency,
    venue,
  });
  const circuit = getCircuit(isolatedKey, threshold, cooldownMs, {
    domain,
    operation,
    dependency,
    venue,
  });
  const now = Date.now();

  if (circuit.state === "OPEN") {
    if (now < circuit.openUntil) {
      throw toOpenError(circuit, "cooldown");
    }
    if (circuit.probeInFlight) {
      throw toOpenError(circuit, "half_open_probe_busy");
    }
    circuit.state = "HALF_OPEN";
    circuit.probeInFlight = true;
    circuit.halfOpenProbeCount += 1;
    emitBreakerEvent(circuit, "BREAKER_HALF_OPEN");
  } else if (circuit.state === "HALF_OPEN" && circuit.probeInFlight) {
    throw toOpenError(circuit, "half_open_probe_busy");
  }

  try {
    const data = await action();
    circuit.consecutiveFailures = 0;
    circuit.lastSuccessAt = Date.now();
    if (circuit.state === "HALF_OPEN") {
      circuit.halfOpenSuccess += 1;
      circuit.probeInFlight = false;
      emitBreakerEvent(circuit, "BREAKER_RECOVERED");
    }
    circuit.state = "CLOSED";
    circuit.openedAt = 0;
    circuit.openUntil = 0;
    circuit.resetCount += 1;
    persistCircuitsToDisk();
    return data;
  } catch (error) {
    const classified = classifyFailure(error, circuit.key, circuit);
    if (!classified.breakerEligible) {
      if (circuit.state === "HALF_OPEN") {
        circuit.halfOpenSuccess += 1;
        circuit.state = "CLOSED";
        circuit.openedAt = 0;
        circuit.openUntil = 0;
        circuit.resetCount += 1;
        emitBreakerEvent(circuit, "BREAKER_RECOVERED", classified.code);
      }
      circuit.probeInFlight = false;
      persistCircuitsToDisk();
      throw error;
    }
    circuit.failureCount += 1;
    circuit.consecutiveFailures += 1;
    circuit.lastFailureAt = Date.now();
    circuit.lastFailureCode = classified.code;
    circuit.lastFailureMessage = String((error as Error)?.message ?? "UNKNOWN_ERROR").slice(0, 400);

    const shouldOpen = circuit.state === "HALF_OPEN" || circuit.consecutiveFailures >= circuit.threshold;
    if (shouldOpen) {
      const backoffMs = nextBackoffMs(circuit, classified);
      circuit.state = "OPEN";
      circuit.openedAt = Date.now();
      circuit.openUntil = Date.now() + backoffMs;
      circuit.openCount += 1;
      emitBreakerEvent(circuit, "BREAKER_OPENED", classified.code);
      if (circuit.probeInFlight) {
        circuit.halfOpenFailure += 1;
      }
    }
    circuit.probeInFlight = false;
    persistCircuitsToDisk();
    throw error;
  }
}

export function getCircuitSnapshot() {
  ensureHydratedFromDisk();
  return Array.from(circuits.values()).map((x) => ({
    key: x.key,
    domain: x.domain,
    operation: x.operation,
    dependency: x.dependency,
    venue: x.venue,
    state: x.state,
    failureCount: x.failureCount,
    consecutiveFailures: x.consecutiveFailures,
    threshold: x.threshold,
    cooldownMs: x.cooldownMs,
    openedAt: x.openedAt ? new Date(x.openedAt).toISOString() : null,
    openUntil: x.openUntil ? new Date(x.openUntil).toISOString() : null,
    lastFailureAt: x.lastFailureAt ? new Date(x.lastFailureAt).toISOString() : null,
    lastSuccessAt: x.lastSuccessAt ? new Date(x.lastSuccessAt).toISOString() : null,
    resetCount: x.resetCount,
    lastFailureCode: x.lastFailureCode,
    lastFailureMessage: x.lastFailureMessage,
    openCount: x.openCount,
    halfOpenProbeCount: x.halfOpenProbeCount,
    halfOpenSuccess: x.halfOpenSuccess,
    halfOpenFailure: x.halfOpenFailure,
  }));
}

export function listBreakerEvents(limit = 200) {
  return breakerEvents.slice(0, limit);
}

export function resetCircuitBreakerForTests(options?: { keepPersistedState?: boolean }) {
  circuits.clear();
  hydrationChecked = false;
  breakerEvents.length = 0;
  if (isBreakerPersistenceEnabled() && options?.keepPersistedState !== true) {
    try {
      unlinkSync(resolveBreakerStatePath());
    } catch {
      // ignore
    }
  }
}

export function exportCircuitSnapshotForPersistence() {
  return getCircuitSnapshot();
}

export function hydrateCircuitSnapshotForTests(snapshot: PersistedCircuitState[]) {
  applyHydrationSnapshot(snapshot);
  hydrationChecked = true;
  persistCircuitsToDisk();
}
