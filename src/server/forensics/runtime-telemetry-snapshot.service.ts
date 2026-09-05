import { getCanonicalAuthorityCounters } from "@/src/server/execution/authority-counters.service";
import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import { getScannerWorkerSnapshot } from "@/src/server/scanner/scanner-worker.service";
import { getCircuitSnapshot } from "@/src/server/resilience/circuit-breaker";
import { getCanonicalInstanceOwnership } from "@/src/server/candidate/instance-ownership.service";
import { summarizeFunnelTraces } from "@/src/server/forensics/candidate-funnel-trace.service";
import { sampleResourceTelemetry } from "@/src/server/forensics/resource-telemetry.service";
import { getShadowOutcomeFinalizerState } from "@/src/server/shadow-outcome/finalizer.service";
import { getForensicSession } from "@/src/server/forensics/forensic-context";
import { listHeartbeats } from "@/src/server/observability/heartbeat";
import { validateCheckpointSchema } from "@/src/server/forensics/checkpoint-schema.service";

export function buildRuntimeTelemetrySnapshot(input: { runId: string; roundId: string; checkpointAt?: string }) {
  const now = Date.now();
  const session = getForensicSession();
  const market = getMarketDataDaemon().telemetry();
  const scanner = getScannerWorkerSnapshot();
  const breakers = getCircuitSnapshot();
  const ownership = getCanonicalInstanceOwnership();
  const funnel = summarizeFunnelTraces(input.runId);
  const authority = getCanonicalAuthorityCounters();
  const resource = sampleResourceTelemetry();
  const pipelineLiveness = listHeartbeats().map((row) => ({
    service: row.service,
    status: row.status,
    updatedAt: row.updatedAt,
    ageMs: Math.max(0, now - new Date(row.updatedAt).getTime()),
    stalled: now - new Date(row.updatedAt).getTime() > 5 * 60_000,
  }));
  const payload = {
    generatedAt: input.checkpointAt ?? new Date().toISOString(),
    campaignId: session?.campaignId ?? null,
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
    ws: {
      lightSocketState: market.lightSocketState,
      deepSocketState: market.deepSocketState,
      socketOpenCount: market.socketOpen,
      socketCloseCount: market.socketClose,
      reconnectAttempts: market.reconnectAttempt,
      reconnectSuccess: market.reconnectSuccess,
      ws1008Count: market.count1008,
      subscriptionRequested: market.subscriptionRequested,
      subscriptionActivated: market.subscriptionActivated,
      subscriptionRemoved: market.subscriptionRemoved,
      duplicateSuppressed: market.duplicateSubscriptionSuppressed,
      maxControlCommandsPerSec: market.controlCommandsPerSecMax,
    },
    rest: {
      publicMarketRestPerMin: market.restCallsPerMin,
      requestWeight: market.actualWeight ?? market.estimatedWeight,
      code429: market.rateLimited429,
      code418: market.banned418,
    },
    pipelineLiveness,
  };
  return {
    ...payload,
    checkpointSchema: validateCheckpointSchema(payload as Record<string, unknown>),
  };
}
