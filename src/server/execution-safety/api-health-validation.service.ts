import { getExchangeInfo, getTicker } from "@/services/binance.service";
import { getCircuitSnapshot } from "@/src/server/resilience/circuit-breaker";
import { MAX_API_LATENCY_MS } from "@/src/server/execution-safety/execution-safety.types";
import type { PreTradeSafetyInput, SafetyValidationStageResult } from "@/src/server/execution-safety/execution-safety.types";
import { getSafetyCache, setSafetyCache } from "@/src/server/execution-safety/safety-cache.service";

const latencySamples: number[] = [];
const MAX_CLOCK_SKEW_MS = 5_000;

async function checkClockSync() {
  const cached = getSafetyCache<{ skewMs: number; ok: boolean }>("clock:sync");
  if (cached) return cached;
  const info = await getExchangeInfo().catch(() => null);
  const serverTime = Number((info as { serverTime?: number } | null)?.serverTime ?? 0);
  const skewMs = serverTime > 0 ? Math.abs(Date.now() - serverTime) : 0;
  const result = { skewMs, ok: serverTime <= 0 || skewMs <= MAX_CLOCK_SKEW_MS };
  setSafetyCache("clock:sync", result, 30_000);
  return result;
}

export async function validateApiHealth(input: PreTradeSafetyInput): Promise<SafetyValidationStageResult> {
  const reasons: string[] = [];
  const started = Date.now();
  const ticker = await getTicker(input.symbol).catch((error) => {
    const message = (error as Error)?.message?.toLowerCase() ?? "";
    if (message.includes("429") || message.includes("rate limit")) reasons.push("429 rate limit detected");
    else if (message.includes("401") || message.includes("403")) reasons.push("Authentication failure");
    else if (message.includes("timeout")) reasons.push("API timeout");
    else if (message.includes("5")) reasons.push("Exchange 5xx error");
    else reasons.push("API connection failure");
    return null;
  });
  const latencyMs = Date.now() - started;
  latencySamples.push(latencyMs);
  if (latencySamples.length > 100) latencySamples.shift();

  const clock = await checkClockSync();
  if (!clock.ok) {
    reasons.push(`Clock synchronization failed (skew ${clock.skewMs}ms)`);
  }

  if (!ticker) {
    return { stage: "API", passed: false, reasons, metadata: { latencyMs, clockSkewMs: clock.skewMs } };
  }

  if (latencyMs > MAX_API_LATENCY_MS) {
    reasons.push(`API latency exceeds threshold (${latencyMs}ms)`);
  }

  const circuits = getCircuitSnapshot();
  const open = circuits.filter((row) => row.state === "OPEN");
  if (open.length > 0) {
    reasons.push("Exchange API circuit open");
  }

  const avgLatency = latencySamples.reduce((sum, value) => sum + value, 0) / Math.max(1, latencySamples.length);
  const connectionQuality = Math.max(0, 100 - avgLatency / 30);

  return {
    stage: "API",
    passed: reasons.length === 0,
    reasons,
    metadata: {
      latencyMs,
      avgLatencyMs: Number(avgLatency.toFixed(2)),
      connectionQuality: Number(connectionQuality.toFixed(2)),
      clockSkewMs: clock.skewMs,
      openCircuits: open.map((row) => row.key),
    },
  };
}

export function getApiLatencyStats() {
  if (latencySamples.length === 0) return { avgMs: 0, maxMs: 0, count: 0 };
  return {
    avgMs: Number((latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length).toFixed(2)),
    maxMs: Math.max(...latencySamples),
    count: latencySamples.length,
  };
}
