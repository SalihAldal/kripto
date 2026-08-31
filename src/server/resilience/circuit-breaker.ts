import { CircuitOpenError } from "@/src/server/errors";

export type BreakerDomain = "MARKET_DATA" | "METADATA" | "ACCOUNT" | "EXECUTION" | "INTERNAL";
export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

type FailureClass = {
  domain: BreakerDomain;
  code: string;
  retryable: boolean;
  breakerEligible: boolean;
  statusCode: number | null;
  retryAfterMs: number | null;
  context: string;
};

type CircuitState = {
  key: string;
  domain: BreakerDomain;
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

function classifyFailure(error: unknown, key: string, domain: BreakerDomain): FailureClass {
  const message = String((error as Error)?.message ?? "UNKNOWN_ERROR");
  const lower = message.toLowerCase();
  const statusCode = parseStatusCode(message);
  const retryAfterMs = parseRetryAfterMs(message);
  const ipBan = lower.includes("http 418") || lower.includes("ip ban");
  const rateLimited = lower.includes("http 429") || lower.includes("too many requests") || lower.includes("rate limit");
  const network = lower.includes("timeout") || lower.includes("econn") || lower.includes("socket") || lower.includes("aborted");
  const retryable = rateLimited || network || (statusCode != null && statusCode >= 500);
  return {
    domain,
    code: ipBan ? "IP_BAN_418" : rateLimited ? "RATE_LIMIT_429" : network ? "NETWORK_ERROR" : "INTERNAL_ERROR",
    retryable,
    breakerEligible: true,
    statusCode,
    retryAfterMs,
    context: key,
  };
}

function inferDomain(key: string): BreakerDomain {
  const lower = key.toLowerCase();
  if (lower.includes("marketdata") || lower.includes("market-data")) return "MARKET_DATA";
  if (lower.includes("exchangeinfo") || lower.includes("metadata")) return "METADATA";
  if (lower.includes("balance") || lower.includes("account")) return "ACCOUNT";
  if (lower.includes("place") || lower.includes("order") || lower.includes("execution")) return "EXECUTION";
  return "INTERNAL";
}

function nextBackoffMs(circuit: CircuitState, failure: FailureClass): number {
  if (failure.statusCode === 418) {
    return Math.max(circuit.cooldownMs * 2, 15 * 60_000);
  }
  const retryAfter = failure.retryAfterMs ?? 0;
  const exponential = circuit.cooldownMs * Math.min(2 ** Math.max(circuit.consecutiveFailures - 1, 0), 16);
  return Math.min(MAX_BACKOFF_MS, Math.max(circuit.cooldownMs, retryAfter, exponential));
}

function getCircuit(key: string, threshold: number, cooldownMs: number, domain?: BreakerDomain): CircuitState {
  const current = circuits.get(key);
  if (current) return current;
  const created: CircuitState = {
    key,
    domain: domain ?? inferDomain(key),
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
  options?: { threshold?: number; cooldownMs?: number; domain?: BreakerDomain },
): Promise<T> {
  const threshold = options?.threshold ?? 4;
  const cooldownMs = options?.cooldownMs ?? 30_000;
  const circuit = getCircuit(key, threshold, cooldownMs, options?.domain);
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
    }
    circuit.state = "CLOSED";
    circuit.openedAt = 0;
    circuit.openUntil = 0;
    circuit.resetCount += 1;
    return data;
  } catch (error) {
    const classified = classifyFailure(error, key, circuit.domain);
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
      if (circuit.probeInFlight) {
        circuit.halfOpenFailure += 1;
      }
    }
    circuit.probeInFlight = false;
    throw error;
  }
}

export function getCircuitSnapshot() {
  return Array.from(circuits.values()).map((x) => ({
    key: x.key,
    domain: x.domain,
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

export function resetCircuitBreakerForTests() {
  circuits.clear();
}
