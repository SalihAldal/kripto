import { getCanonicalAuthorityCounters } from "@/src/server/execution/authority-counters.service";
import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import { getScannerWorkerSnapshot } from "@/src/server/scanner/scanner-worker.service";
import { getCircuitSnapshot } from "@/src/server/resilience/circuit-breaker";
import { getCanonicalInstanceOwnership } from "@/src/server/candidate/instance-ownership.service";
import { summarizeFunnelTraces } from "@/src/server/forensics/candidate-funnel-trace.service";
import { sampleResourceTelemetry } from "@/src/server/forensics/resource-telemetry.service";
import { getShadowOutcomeFinalizerState } from "@/src/server/shadow-outcome/finalizer.service";

export function buildRuntimeTelemetrySnapshot(input: { runId: string; roundId: string; checkpointAt?: string }) {
  const market = getMarketDataDaemon().telemetry();
  const scanner = getScannerWorkerSnapshot();
  const breakers = getCircuitSnapshot();
  const ownership = getCanonicalInstanceOwnership();
  const funnel = summarizeFunnelTraces(input.runId);
  const authority = getCanonicalAuthorityCounters();
  const resource = sampleResourceTelemetry();
  return {
    generatedAt: input.checkpointAt ?? new Date().toISOString(),
    runId: input.runId,
    roundId: input.roundId,
    ownership,
    marketData: market,
    scanner: {
      updatedAt: scanner.updatedAt,
      opportunity: scanner.opportunity,
      microstructure: scanner.microstructure,
      candidateStore: scanner.candidateStore,
      shadowOutcome: scanner.shadowOutcome,
      shadowOutcomeFinalizer: getShadowOutcomeFinalizerState(),
    },
    pipelineFunnel: funnel,
    authority,
    resources: {
      cpuPercent: resource.cpuPercent,
      eventLoopLagP95Ms: resource.eventLoopLagP95Ms,
      redisLatencyMs: market.redisLatencyMs ?? null,
      memory: resource.memory,
      alerts: [
        ...resource.alerts,
        ...(typeof market.redisLatencyMs === "number" && market.redisLatencyMs > 200 ? ["REDIS_LATENCY_HIGH"] : []),
      ],
      sampledAt: resource.timestamp,
    },
    breaker: {
      domains: breakers,
      summary: {
        total: breakers.length,
        open: breakers.filter((row) => row.state === "OPEN").length,
        halfOpen: breakers.filter((row) => row.state === "HALF_OPEN").length,
      },
    },
  };
}
