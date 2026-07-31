import type { LatencyBreakdown } from "@/src/server/exchange-simulator/exchange-simulator.types";

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export function simulateLatency(): LatencyBreakdown {
  const networkMs = randomBetween(45, 145);
  const exchangeMs = randomBetween(18, 78);
  const queueMs = randomBetween(4, 28);
  const matchingMs = randomBetween(8, 38);
  const totalMs = networkMs + exchangeMs + queueMs + matchingMs;
  return {
    networkMs: Number(networkMs.toFixed(2)),
    exchangeMs: Number(exchangeMs.toFixed(2)),
    queueMs: Number(queueMs.toFixed(2)),
    matchingMs: Number(matchingMs.toFixed(2)),
    totalMs: Number(totalMs.toFixed(2)),
  };
}

export async function applyLatencyDelay(latency: LatencyBreakdown) {
  const delay = Math.min(350, Math.max(20, Math.floor(latency.totalMs)));
  await new Promise((resolve) => setTimeout(resolve, delay));
  return delay;
}

export function analyzeLatencySamples(samples: LatencyBreakdown[]) {
  if (samples.length === 0) {
    return { avgTotalMs: 0, p95TotalMs: 0, avgNetworkMs: 0, avgMatchingMs: 0 };
  }
  const totals = samples.map((row) => row.totalMs).sort((a, b) => a - b);
  const p95Index = Math.min(totals.length - 1, Math.floor(totals.length * 0.95));
  return {
    avgTotalMs: Number((totals.reduce((sum, value) => sum + value, 0) / totals.length).toFixed(2)),
    p95TotalMs: totals[p95Index] ?? 0,
    avgNetworkMs: Number((samples.reduce((sum, row) => sum + row.networkMs, 0) / samples.length).toFixed(2)),
    avgMatchingMs: Number((samples.reduce((sum, row) => sum + row.matchingMs, 0) / samples.length).toFixed(2)),
  };
}
