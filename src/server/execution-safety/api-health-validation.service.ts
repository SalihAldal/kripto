import { getTicker } from "@/services/binance.service";
import { getCircuitSnapshot } from "@/src/server/resilience/circuit-breaker";
import { MAX_API_LATENCY_MS } from "@/src/server/execution-safety/execution-safety.types";
import type { PreTradeSafetyInput, SafetyValidationStageResult } from "@/src/server/execution-safety/execution-safety.types";
import {
  evaluateClockSync,
  persistClockSyncForensics,
} from "@/src/server/execution-safety/clock-sync.service";

const latencySamples: number[] = [];

type CircuitSnapshotRow = ReturnType<typeof getCircuitSnapshot>[number];

export function selectExecutionRelevantCircuits(
  input: Pick<PreTradeSafetyInput, "mode" | "venue">,
  circuits: CircuitSnapshotRow[],
) {
  const allowed =
    input.mode === "paper"
      ? new Set(["MARKET_DATA", "EXCHANGE_INFO", "SYMBOL_FILTER", "PRICE", "ORDER_BOOK", "PAPER_EXECUTION"])
      : new Set(["MARKET_DATA", "EXCHANGE_INFO", "SYMBOL_FILTER", "PRICE", "ORDER_BOOK", "BALANCE", "CLOCK_SYNC", "LIVE_EXECUTION"]);
  const requestedVenue = String(input.venue ?? "").toLowerCase();
  return circuits.filter((row) => {
    if (row.state !== "OPEN" || !allowed.has(row.domain)) return false;
    const circuitVenue = String(row.venue ?? "").toLowerCase();
    return !requestedVenue || !circuitVenue || circuitVenue === "default" || circuitVenue === requestedVenue;
  });
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

  const clock = input.mode === "live" ? await evaluateClockSync() : null;
  if (clock && !clock.ok) {
    reasons.push(`Clock synchronization failed (skew ${Number.isFinite(clock.skewMs) ? clock.skewMs : "unknown"}ms)`);
  }
  if (clock) {
    persistClockSyncForensics(clock.forensics, {
      executionId: input.executionId,
      sessionId: input.sessionId,
      roundId: input.roundId,
    });
  }

  if (!ticker) {
    return {
      stage: "API",
      passed: false,
      reasons,
      metadata: {
        latencyMs,
        clockSyncRequired: input.mode === "live",
        clockSkewMs: clock?.skewMs ?? null,
        clockForensics: clock?.forensics ?? null,
      },
    };
  }

  if (latencyMs > MAX_API_LATENCY_MS) {
    reasons.push(`API latency exceeds threshold (${latencyMs}ms)`);
  }

  const circuits = getCircuitSnapshot();
  const open = selectExecutionRelevantCircuits(input, circuits);
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
      clockSyncRequired: input.mode === "live",
      clockSkewMs: clock?.skewMs ?? null,
      clockForensics: clock?.forensics ?? null,
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

export { MAX_CLOCK_SKEW_MS } from "@/src/server/execution-safety/clock-sync.service";
