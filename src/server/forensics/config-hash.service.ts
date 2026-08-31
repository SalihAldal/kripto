import { createHash } from "node:crypto";

function stableNormalize(value: unknown): unknown {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((item) => stableNormalize(item));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      out[key] = stableNormalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

export function hashCanonicalConfig(payload: unknown) {
  const normalized = stableNormalize(payload);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function evaluateConfigDrift(input: { initialHash: string; currentHash: string; runId?: string }) {
  const driftDetected = input.initialHash.trim().length > 0 && input.currentHash.trim().length > 0
    ? input.initialHash !== input.currentHash
    : false;
  return {
    runId: input.runId ?? null,
    initialHash: input.initialHash,
    currentHash: input.currentHash,
    driftDetected,
    status: driftDetected ? "CONFIG_DRIFT_DETECTED" : "CONFIG_STABLE",
    checkedAt: new Date().toISOString(),
  } as const;
}
