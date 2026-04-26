import { CircuitOpenError } from "@/src/server/errors";

type CircuitState = {
  key: string;
  failures: number;
  threshold: number;
  cooldownMs: number;
  lastFailureAt: number;
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
};

const circuits = new Map<string, CircuitState>();

function getCircuit(key: string, threshold: number, cooldownMs: number): CircuitState {
  const current = circuits.get(key);
  if (current) return current;
  const created: CircuitState = {
    key,
    failures: 0,
    threshold,
    cooldownMs,
    lastFailureAt: 0,
    state: "CLOSED",
  };
  circuits.set(key, created);
  return created;
}

export async function withCircuitBreaker<T>(
  key: string,
  action: () => Promise<T>,
  options?: { threshold?: number; cooldownMs?: number },
): Promise<T> {
  const threshold = options?.threshold ?? 4;
  const cooldownMs = options?.cooldownMs ?? 30_000;
  const circuit = getCircuit(key, threshold, cooldownMs);
  const now = Date.now();

  if (circuit.state === "OPEN") {
    const elapsed = now - circuit.lastFailureAt;
    if (elapsed < circuit.cooldownMs) {
      throw new CircuitOpenError(`Circuit is open for ${key}`, {
        key,
        retryInMs: circuit.cooldownMs - elapsed,
      });
    }
    circuit.state = "HALF_OPEN";
  }

  try {
    const data = await action();
    circuit.failures = 0;
    circuit.state = "CLOSED";
    return data;
  } catch (error) {
    circuit.failures += 1;
    circuit.lastFailureAt = Date.now();
    if (circuit.failures >= circuit.threshold) {
      circuit.state = "OPEN";
    }
    throw error;
  }
}

export function getCircuitSnapshot() {
  return Array.from(circuits.values()).map((x) => ({
    key: x.key,
    state: x.state,
    failures: x.failures,
    threshold: x.threshold,
    cooldownMs: x.cooldownMs,
    lastFailureAt: x.lastFailureAt ? new Date(x.lastFailureAt).toISOString() : null,
  }));
}
